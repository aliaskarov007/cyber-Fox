import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import {
  InvoiceStatus,
  type PaymentIntent,
  PaymentIntentStatus,
  PaymentMethod,
  PaymentPurpose,
  SubscriptionStatus,
  TransactionType,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { HmacPaymentProvider } from "./payment.provider.js";
import {
  ApplyDecision,
  canReuseIntent,
  decideApply,
  idempotencyKey,
  minuteBucket,
} from "./payment.rules.js";

/** Сколько живёт неоплаченный платёж. Дольше держать бессмысленно: гость ушёл. */
const INTENT_TTL_MS = 30 * 60_000;

/** Пополнение с игрового ПК: от 100 ₸ до 200 000 ₸, в тиын. */
export const COMPUTER_TOPUP_MIN = 10_000;
export const COMPUTER_TOPUP_MAX = 20_000_000;

/**
 * Что показать гостю на игровом ПК.
 *
 * dynamic — банк подключён: QR уже с суммой, зачисление придёт само.
 * static — банк ещё не подключён: показываем статический QR клуба из
 * банковского приложения, гость вводит сумму сам, администратор подтверждает.
 */
export type ComputerTopUp =
  | {
      ok: true;
      reason: null;
      intentId: string;
      amount: number;
      mode: "dynamic" | "static";
      qrPayload: string | null;
      qrImageUrl: string | null;
      expiresAt: Date;
    }
  | { ok: false; reason: string };

export interface CheckoutResult {
  intentId: string;
  amount: number;
  /** Ссылка на оплату; пусто — провайдер не настроен, платят на стойке. */
  url: string | null;
  qrPayload: string | null;
  provider: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
    private readonly provider: HmacPaymentProvider,
    private readonly bus: RealtimeBus,
  ) {}

  /**
   * Пополнение по единому QR с экрана игрового ПК. Гостя определяет шлюз —
   * по сессии машины или по только что выполненному входу.
   */
  async createTopUpForComputer(
    computerId: string,
    guestId: string,
    amount: number,
  ): Promise<ComputerTopUp> {
    if (!Number.isInteger(amount) || amount < COMPUTER_TOPUP_MIN || amount > COMPUTER_TOPUP_MAX) {
      return { ok: false, reason: "Сумма пополнения — от 100 до 200 000 ₸" };
    }

    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };

    const dynamic = this.provider.isConfigured;
    const staticImage = computer.club.paymentQrImageUrl;
    if (!dynamic && !staticImage) {
      return {
        ok: false,
        reason: "Оплата по QR в клубе пока не подключена. Пополните счёт у администратора.",
      };
    }

    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.tenantId !== computer.club.tenantId) {
      return { ok: false, reason: "Гость не найден" };
    }

    const result = await this.createIntent({
      tenantId: computer.club.tenantId,
      clubId: computer.clubId,
      purpose: PaymentPurpose.GUEST_TOPUP,
      amount,
      guestId,
      computerId,
      description: `Пополнение счёта — ${guest.fullName}`,
    });

    if (!dynamic) {
      // Банк о платеже не сообщит — кассе нужно знать, чей перевод ждать.
      this.bus.emit("topup.pending", { clubId: computer.clubId, intentId: result.intentId });
    }

    return {
      ok: true,
      reason: null,
      intentId: result.intentId,
      amount: result.amount,
      mode: dynamic ? "dynamic" : "static",
      qrPayload: dynamic ? result.qrPayload : null,
      qrImageUrl: dynamic ? null : staticImage,
      expiresAt: result.expiresAt,
    };
  }

  /** Онлайн-пополнение счёта гостя: ссылка или QR, который гость открывает с телефона. */
  async createTopUp(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
    amount: number,
  ): Promise<CheckoutResult> {
    await this.access.requireClub(staff, clubId);
    if (amount <= 0) throw new BadRequestException("Сумма должна быть больше нуля");

    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.tenantId !== staff.tenantId) throw new NotFoundException("Гость не найден");

    return this.createIntent({
      tenantId: staff.tenantId,
      clubId,
      purpose: PaymentPurpose.GUEST_TOPUP,
      amount,
      guestId,
      description: `Пополнение счёта — ${guest.fullName}`,
    });
  }

  /** Оплата нашего счёта клубом. */
  async createInvoicePayment(
    staff: AuthenticatedStaff,
    invoiceId: string,
  ): Promise<CheckoutResult> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.tenantId !== staff.tenantId) {
      throw new NotFoundException("Счёт не найден");
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException("Счёт уже оплачен");
    }

    return this.createIntent({
      tenantId: staff.tenantId,
      clubId: null,
      purpose: PaymentPurpose.SUBSCRIPTION_INVOICE,
      amount: invoice.amount,
      invoiceId,
      description: "Подписка Cyber-Fox",
    });
  }

  private async createIntent(params: {
    tenantId: string;
    clubId: string | null;
    purpose: PaymentPurpose;
    amount: number;
    guestId?: string;
    invoiceId?: string;
    computerId?: string;
    description: string;
  }): Promise<CheckoutResult & { expiresAt: Date }> {
    // Повторный клик по кнопке в пределах минуты — то же намерение, а не второй счёт.
    const now = new Date();
    const baseKey = idempotencyKey({
      purpose: params.purpose,
      subjectId: params.guestId ?? params.invoiceId ?? params.tenantId,
      amount: params.amount,
      minuteBucket: minuteBucket(now),
    });

    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: baseKey },
    });
    if (existing && canReuseIntent(existing, now)) {
      return { ...this.toResult(existing), expiresAt: existing.expiresAt };
    }

    // Тот же ключ, но платёж уже закрыт: гость платит второй раз подряд ту же
    // сумму. Разводим их суффиксом, иначе второе пополнение молча пропадёт.
    const key = existing ? `${baseKey}:${randomUUID().slice(0, 8)}` : baseKey;

    const checkout = await this.provider.createCheckout({
      intentId: key,
      amount: params.amount,
      description: params.description,
      returnUrl: "/",
    });

    const intent = await this.prisma.paymentIntent.create({
      data: {
        tenantId: params.tenantId,
        clubId: params.clubId,
        purpose: params.purpose,
        amount: params.amount,
        guestId: params.guestId ?? null,
        invoiceId: params.invoiceId ?? null,
        provider: this.provider.name,
        providerRef: checkout.providerRef,
        checkoutUrl: checkout.url,
        computerId: params.computerId ?? null,
        idempotencyKey: key,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });

    return { ...this.toResult(intent), expiresAt: intent.expiresAt };
  }

  private toResult(intent: PaymentIntent): CheckoutResult {
    return {
      intentId: intent.id,
      amount: intent.amount,
      // Ссылка хранится с платежом: второй клик по кнопке должен показать
      // тот же QR, а не пустоту.
      url: intent.checkoutUrl,
      qrPayload: intent.checkoutUrl,
      provider: intent.provider,
    };
  }

  /**
   * Подтверждение оплаты от провайдера.
   *
   * Вызывается из вебхука и с кнопки «оплачено» на стойке. Обе двери ведут
   * сюда, чтобы правила зачисления были одни и те же.
   */
  async confirm(
    providerRef: string,
    claim: { paid: boolean; amount: number },
  ): Promise<{ applied: boolean; reason: string | null }> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { providerRef },
    });
    if (!intent) throw new NotFoundException("Платёж не найден");

    const { decision, reason } = decideApply(intent, claim, new Date());

    if (decision === ApplyDecision.DUPLICATE) {
      return { applied: false, reason: null };
    }

    if (decision === ApplyDecision.REJECT) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      return { applied: false, reason };
    }

    if (decision === ApplyDecision.CONFLICT) {
      // Не гадаем: расхождение по сумме или оплата отменённого счёта — это
      // разбор человеком, а не автоматическое зачисление.
      this.logger.error(`Платёж ${intent.id}: ${reason}`);
      return { applied: false, reason };
    }

    const applied = await this.applySuccess(intent);
    if (applied && intent.purpose === PaymentPurpose.GUEST_TOPUP && intent.guestId && intent.clubId) {
      this.bus.emit("topup.paid", {
        clubId: intent.clubId,
        computerId: intent.computerId,
        intentId: intent.id,
        guestId: intent.guestId,
        amount: intent.amount,
      });
    }
    if (reason) this.logger.warn(`Платёж ${intent.id}: ${reason}`);
    return { applied: true, reason };
  }

  /** true — деньги зачислены этим вызовом, а не параллельным дублем. */
  private async applySuccess(intent: PaymentIntent): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      /*
       * Статус меняем первым: параллельный дубль вебхука упрётся в него.
       * Просроченный тоже забираем: деньги уже взяты (см. decideApply), а
       * прежде такой платёж молча не зачислялся — фоновая задача успевала
       * перевести его в EXPIRED, и условие на PENDING его не находило.
       */
      const claimed = await tx.paymentIntent.updateMany({
        where: {
          id: intent.id,
          status: { in: [PaymentIntentStatus.PENDING, PaymentIntentStatus.EXPIRED] },
        },
        data: { status: PaymentIntentStatus.SUCCEEDED, paidAt: new Date() },
      });
      if (claimed.count === 0) return false;

      if (intent.purpose === PaymentPurpose.GUEST_TOPUP && intent.guestId && intent.clubId) {
        const wallet = await this.wallets.resolveWallet(intent.guestId, intent.clubId, tx);
        await this.wallets.record(tx, {
          walletId: wallet.id,
          clubId: intent.clubId,
          amount: intent.amount,
          type: TransactionType.TOPUP,
          comment: "Онлайн-оплата",
        });

        // Платёж попадает в кассу смены: иначе онлайн-выручка не сойдётся
        // с отчётом, хотя наличных в ящике от неё и не прибавилось.
        const shift = await tx.shift.findFirst({
          where: { clubId: intent.clubId, closedAt: null },
          orderBy: { openedAt: "desc" },
        });
        await tx.payment.create({
          data: {
            clubId: intent.clubId,
            guestId: intent.guestId,
            shiftId: shift?.id ?? null,
            amount: intent.amount,
            method: PaymentMethod.ONLINE,
          },
        });
        return true;
      }

      if (intent.purpose === PaymentPurpose.SUBSCRIPTION_INVOICE && intent.invoiceId) {
        const invoice = await tx.invoice.update({
          where: { id: intent.invoiceId },
          data: { status: InvoiceStatus.PAID, paidAt: new Date() },
        });

        const subscription = await tx.subscription.findUnique({
          where: { tenantId: intent.tenantId },
        });
        if (subscription) {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: SubscriptionStatus.ACTIVE,
              currentPeriodEnd: invoice.periodEnd,
              graceEndsAt: null,
            },
          });
        }
      }
      return true;
    });
  }

  /** Ручное подтверждение на стойке: гость заплатил переводом, кассир отмечает. */
  async confirmManually(
    staff: AuthenticatedStaff,
    intentId: string,
  ): Promise<{ applied: boolean; reason: string | null }> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.tenantId !== staff.tenantId) {
      throw new NotFoundException("Платёж не найден");
    }

    // Счёт за подписку клуб платит нам, а не себе: закрыть его может только
    // подтверждение провайдера. Иначе кнопка «оплата поступила» превращается
    // в бесплатную подписку.
    if (intent.purpose === PaymentPurpose.SUBSCRIPTION_INVOICE) {
      throw new ForbiddenException("Счёт за подписку закрывается только платежом");
    }
    if (intent.clubId) await this.access.requireClub(staff, intent.clubId);
    if (!intent.providerRef) throw new BadRequestException("У платежа нет идентификатора");

    return this.confirm(intent.providerRef, { paid: true, amount: intent.amount });
  }

  /**
   * Пополнения по статическому QR с игровых ПК, которые ждут кассира: банк о
   * них не сообщит. Просроченные за последние часы тоже — гость мог оплатить
   * и уйти играть, а подтверждение не должно пропасть из-за таймера.
   */
  async pendingQr(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);
    const intents = await this.prisma.paymentIntent.findMany({
      where: {
        clubId,
        purpose: PaymentPurpose.GUEST_TOPUP,
        computerId: { not: null },
        status: { in: [PaymentIntentStatus.PENDING, PaymentIntentStatus.EXPIRED] },
        checkoutUrl: null,
        createdAt: { gte: new Date(Date.now() - 3 * 60 * 60_000) },
      },
      include: { guest: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const computerIds = [...new Set(intents.map((i) => i.computerId!))];
    const computers = await this.prisma.computer.findMany({
      where: { id: { in: computerIds } },
      select: { id: true, name: true },
    });
    const names = new Map(computers.map((c) => [c.id, c.name]));

    return intents.map((i) => ({
      id: i.id,
      amount: i.amount,
      status: i.status,
      guestName: i.guest?.fullName ?? "—",
      guestPhone: i.guest?.phone ?? null,
      computerName: names.get(i.computerId!) ?? "Машина зала",
      createdAt: i.createdAt,
    }));
  }

  /** Перевод не пришёл — убрать платёж из ожидающих. */
  async cancelManually(staff: AuthenticatedStaff, intentId: string): Promise<{ ok: boolean }> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.tenantId !== staff.tenantId || !intent.clubId) {
      throw new NotFoundException("Платёж не найден");
    }
    await this.access.requireClub(staff, intent.clubId);
    const changed = await this.prisma.paymentIntent.updateMany({
      where: {
        id: intent.id,
        status: { in: [PaymentIntentStatus.PENDING, PaymentIntentStatus.EXPIRED] },
      },
      data: { status: PaymentIntentStatus.CANCELED },
    });
    return { ok: changed.count > 0 };
  }

  async list(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);
    return this.prisma.paymentIntent.findMany({
      where: { clubId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { guest: { select: { fullName: true, phone: true } } },
    });
  }

  /** Неоплаченные платежи протухают: висящий счёт путает кассира. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireStale(): Promise<void> {
    const result = await this.prisma.paymentIntent.updateMany({
      where: { status: PaymentIntentStatus.PENDING, expiresAt: { lt: new Date() } },
      data: { status: PaymentIntentStatus.EXPIRED },
    });
    if (result.count > 0) {
      this.logger.debug(`Просрочено платежей: ${result.count}`);
    }
  }
}
