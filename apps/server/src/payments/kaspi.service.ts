import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PaymentIntentStatus, PaymentPurpose } from "@prisma/client";
import { randomUUID } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { ApiPayClient } from "./apipay.client.js";
import {
  APIPAY_REF_PREFIX,
  apipayRef,
  decideApiPay,
  maskPhone,
  tiynToTenge,
  toKaspiPhone,
  verifyApiPaySignature,
} from "./apipay.rules.js";
import { COMPUTER_TOPUP_MAX, COMPUTER_TOPUP_MIN, type ComputerTopUp, PaymentsService } from "./payments.service.js";

/** QR живёт у Kaspi своё время; у нас неоплаченный платёж висит не дольше получаса. */
const INTENT_TTL_MS = 30 * 60_000;
/** Счёт на телефон Kaspi держит сутки, но гость за ПК ждёт минуты. */
const PHONE_TTL_MS = 30 * 60_000;

export type TopUpMethod = "qr" | "phone";

export interface PublicKaspiChannel {
  connected: boolean;
  enabled: boolean;
  /** Путь для уведомлений; полный адрес собирает касса из своего домена. */
  webhookPath: string | null;
  lastState: string | null;
  lastCheckAt: Date | null;
}

/**
 * Kaspi Pay через ApiPay: счёт под конкретный платёж, оплата в приложении
 * Kaspi, зачисление по подписанному уведомлению — без администратора.
 *
 * Кому зачислить, решено в момент создания платежа: гость записан в нём, а
 * ApiPay возвращает наш номер платежа. Если канал выключен или не настроен,
 * пополнение идёт прежним путём — статический QR клуба и подтверждение кассой.
 */
@Injectable()
export class KaspiService {
  private readonly logger = new Logger(KaspiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apipay: ApiPayClient,
    private readonly payments: PaymentsService,
    private readonly bus: RealtimeBus,
  ) {}

  // --- Настройки (владелец сети) ---

  async get(staff: AuthenticatedStaff): Promise<PublicKaspiChannel> {
    const channel = await this.prisma.kaspiChannel.findUnique({ where: { tenantId: staff.tenantId } });
    return {
      connected: channel !== null,
      enabled: channel?.enabled ?? false,
      webhookPath: channel ? `/api/payments/apipay/${channel.webhookToken}` : null,
      lastState: channel?.lastState ?? null,
      lastCheckAt: channel?.lastCheckAt ?? null,
    };
  }

  /**
   * Сохранение ключей. Ключ сразу проверяется у ApiPay: неверный видно здесь,
   * а не по гостю, у которого на экране не появился QR.
   */
  async save(
    staff: AuthenticatedStaff,
    dto: { apiKey?: string; webhookSecret?: string; enabled?: boolean },
  ): Promise<PublicKaspiChannel> {
    const existing = await this.prisma.kaspiChannel.findUnique({ where: { tenantId: staff.tenantId } });
    const apiKey = dto.apiKey?.trim() || existing?.apiKey;
    const webhookSecret = dto.webhookSecret?.trim() || existing?.webhookSecret;
    if (!apiKey) throw new BadRequestException("Укажите ключ API из кабинета ApiPay");
    if (!webhookSecret) throw new BadRequestException("Укажите секрет уведомлений из кабинета ApiPay");

    const health = await this.apipay.health(apiKey);
    if (!health.ok && health.code !== "kyc_required") throw new BadRequestException(health.error);
    const lastState = health.ok ? "ok" : health.error;

    await this.prisma.kaspiChannel.upsert({
      where: { tenantId: staff.tenantId },
      create: {
        tenantId: staff.tenantId,
        apiKey,
        webhookSecret,
        enabled: dto.enabled ?? true,
        lastState,
        lastCheckAt: new Date(),
      },
      update: {
        apiKey,
        webhookSecret,
        ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
        lastState,
        lastCheckAt: new Date(),
      },
    });
    return this.get(staff);
  }

  async disconnect(staff: AuthenticatedStaff): Promise<PublicKaspiChannel> {
    await this.prisma.kaspiChannel.deleteMany({ where: { tenantId: staff.tenantId } });
    return this.get(staff);
  }

  // --- Пополнение с игрового ПК ---

  /** Что показать гостю: можно ли платить через Kaspi и есть ли запасной QR клуба. */
  async options(computerId: string): Promise<{ kaspi: boolean; staticQr: boolean }> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { club: { select: { tenantId: true, paymentQrImageUrl: true } } },
    });
    if (!computer) return { kaspi: false, staticQr: false };
    const channel = await this.prisma.kaspiChannel.findUnique({ where: { tenantId: computer.club.tenantId } });
    return { kaspi: Boolean(channel?.enabled), staticQr: Boolean(computer.club.paymentQrImageUrl) };
  }

  /**
   * Пополнение. Kaspi подключён — счёт в ApiPay под этот платёж; нет — прежний
   * путь со статическим QR клуба.
   */
  async createForComputer(
    computerId: string,
    guestId: string,
    amount: number,
    method: TopUpMethod,
  ): Promise<ComputerTopUp> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };

    const channel = await this.prisma.kaspiChannel.findUnique({ where: { tenantId: computer.club.tenantId } });
    if (!channel?.enabled) return this.payments.createTopUpForComputer(computerId, guestId, amount);

    if (!Number.isInteger(amount) || amount < COMPUTER_TOPUP_MIN || amount > COMPUTER_TOPUP_MAX) {
      return { ok: false, reason: "Сумма пополнения — от 100 до 200 000 ₸" };
    }
    const tenge = tiynToTenge(amount);
    if (tenge === null) return { ok: false, reason: "Сумма — в целых тенге" };

    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.tenantId !== computer.club.tenantId) return { ok: false, reason: "Гость не найден" };

    const phone = method === "phone" ? toKaspiPhone(guest.phone) : null;
    if (method === "phone" && !phone) {
      return { ok: false, reason: "Номер в аккаунте не похож на казахстанский — оплатите по QR" };
    }

    const intent = await this.prisma.paymentIntent.create({
      data: {
        tenantId: computer.club.tenantId,
        clubId: computer.clubId,
        purpose: PaymentPurpose.GUEST_TOPUP,
        amount,
        guestId,
        computerId,
        provider: "apipay",
        idempotencyKey: `apipay:${randomUUID()}`,
        expiresAt: new Date(Date.now() + (method === "phone" ? PHONE_TTL_MS : INTENT_TTL_MS)),
      },
    });

    const description = `Пополнение счёта в ${computer.club.name}`;
    const created =
      method === "phone"
        ? await this.apipay.createPhoneInvoice(channel.apiKey, {
            phone: phone!,
            amountTenge: tenge,
            description,
            externalId: intent.id,
          })
        : await this.apipay.createQrInvoice(channel.apiKey, {
            amountTenge: tenge,
            description,
            externalId: intent.id,
          });

    if (!created.ok) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      this.logger.warn(`ApiPay не выставил счёт ${intent.id}: ${created.error}`);
      return { ok: false, reason: created.error };
    }

    const invoice = created.data as typeof created.data & {
      qr_image_url?: string | null;
      qr_token_url?: string | null;
      qr_expires_at?: string | null;
    };
    const qrExpires = invoice.qr_expires_at ? new Date(invoice.qr_expires_at) : null;
    const updated = await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        providerRef: apipayRef(invoice.id),
        checkoutUrl: invoice.qr_token_url ?? null,
        ...(qrExpires && !Number.isNaN(qrExpires.getTime()) ? { expiresAt: qrExpires } : {}),
      },
    });

    return {
      ok: true,
      reason: null,
      intentId: updated.id,
      amount: updated.amount,
      mode: method === "phone" ? "kaspi_phone" : "kaspi_qr",
      qrPayload: method === "qr" ? (invoice.qr_token_url ?? null) : null,
      qrImageUrl: method === "qr" ? (invoice.qr_image_url ?? null) : null,
      phoneMasked: phone ? maskPhone(phone) : null,
      expiresAt: updated.expiresAt,
    };
  }

  // --- Уведомления ApiPay ---

  /**
   * Уведомление об изменении счёта. Сеть узнаётся по адресу, подлинность — по
   * подписи её секретом. Неподписанное и чужое отбрасывается до разбора.
   */
  async handleWebhook(
    token: string,
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ accepted: boolean; reason?: string }> {
    const channel = await this.prisma.kaspiChannel.findUnique({ where: { webhookToken: token } });
    if (!channel) throw new NotFoundException("Неизвестный адрес уведомлений");
    if (!verifyApiPaySignature(rawBody, signature, channel.webhookSecret)) {
      throw new BadRequestException("Неверная подпись");
    }

    let payload: { event?: string; invoice?: unknown };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      return { accepted: false, reason: "Уведомление не разобрано" };
    }

    // Проверка из кабинета ApiPay — отвечаем «принято», чтобы владелец увидел, что адрес верный.
    if (payload.event === "webhook.test") return { accepted: true };
    if (payload.event !== "invoice.status_changed") return { accepted: true, reason: "Событие не нужно" };

    await this.apply(channel.tenantId, payload.invoice);
    return { accepted: true };
  }

  /** Применить статус счёта — из уведомления или из сверки. */
  private async apply(tenantId: string, invoice: unknown): Promise<void> {
    const action = decideApiPay(invoice);
    if (action.kind === "ignore") return;

    const intent = await this.prisma.paymentIntent.findUnique({
      where: { providerRef: apipayRef(action.invoiceId) },
    });
    // Чужой счёт или счёт не из Cyber-Fox (выставлен руками в кабинете) — не наш.
    if (!intent || intent.tenantId !== tenantId) return;
    if (action.externalId && action.externalId !== intent.id) {
      this.logger.error(`Счёт ApiPay ${action.invoiceId}: номер платежа не совпал с ${intent.id}`);
      return;
    }

    if (action.kind === "paid") {
      // Те же правила, что у любого провайдера: сумма сверяется, дубль не зачисляется.
      const result = await this.payments.confirm(intent.providerRef!, { paid: true, amount: action.amount });
      if (!result.applied && result.reason) this.logger.warn(`Платёж ${intent.id}: ${result.reason}`);
      return;
    }

    const changed = await this.prisma.paymentIntent.updateMany({
      where: { id: intent.id, status: PaymentIntentStatus.PENDING },
      data: { status: action.expired ? PaymentIntentStatus.EXPIRED : PaymentIntentStatus.FAILED },
    });
    if (changed.count > 0 && intent.clubId) {
      this.bus.emit("topup.failed", {
        clubId: intent.clubId,
        computerId: intent.computerId,
        intentId: intent.id,
        reason: action.reason,
      });
    }
  }

  /**
   * Сверка: уведомление могло задержаться или потеряться. Раз в минуту
   * спрашиваем ApiPay о свежих неоплаченных счетах — оплаченный не пропадёт.
   * Смотрим и уже помеченные просроченными: деньги могли прийти позже.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    const since = new Date(Date.now() - 3 * 60 * 60_000);
    const stale = new Date(Date.now() - 60_000);
    const intents = await this.prisma.paymentIntent.findMany({
      where: {
        provider: "apipay",
        status: { in: [PaymentIntentStatus.PENDING, PaymentIntentStatus.EXPIRED] },
        providerRef: { startsWith: APIPAY_REF_PREFIX },
        createdAt: { gte: since, lte: stale },
      },
      take: 50,
      orderBy: { createdAt: "asc" },
    });
    if (intents.length === 0) return;

    const channels = await this.prisma.kaspiChannel.findMany({
      where: { tenantId: { in: [...new Set(intents.map((i) => i.tenantId))] } },
    });
    const keyByTenant = new Map(channels.map((c) => [c.tenantId, c.apiKey]));

    for (const intent of intents) {
      const apiKey = keyByTenant.get(intent.tenantId);
      if (!apiKey) continue;
      const result = await this.apipay.getInvoice(apiKey, intent.providerRef!.slice(APIPAY_REF_PREFIX.length));
      if (!result.ok) continue;
      // Просроченный у нас, но всё ещё ждущий у Kaspi — не трогаем: вдруг оплатят.
      if (intent.status === PaymentIntentStatus.EXPIRED && result.data.status !== "paid") continue;
      await this.apply(intent.tenantId, result.data).catch((error: Error) =>
        this.logger.warn(`Сверка ${intent.id}: ${error.message}`),
      );
    }
  }
}
