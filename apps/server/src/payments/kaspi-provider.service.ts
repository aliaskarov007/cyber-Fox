import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Club, type Guest, type KaspiTxn, PaymentIntentStatus, PaymentPurpose } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  KASPI_ACCOUNT_REGEX,
  KaspiResult,
  type KaspiReply,
  type KaspiResultCode,
  accountToPhone,
  buildReply,
  isAllowedIp,
  maskGuestName,
  parseAllowedIps,
  parseBin,
  parseSum,
  parseTxnDate,
  parseTxnId,
  withBin,
} from "./kaspi-provider.rules.js";
import { PaymentsService } from "./payments.service.js";

export interface PublicKaspiProvider {
  connected: boolean;
  enabled: boolean;
  /** Путь для Kaspi; полный адрес собирает касса из своего домена. */
  path: string | null;
  /** Регулярное выражение для поля «номер телефона», которое просит Kaspi. */
  accountRegex: string;
  allowedIps: string[];
  /** БИН/ИИН получателя, который уходит в каждом ответе Kaspi. */
  bin: string | null;
}

/** Срок у намерения формальный: деньги к моменту pay уже списаны у гостя. */
const INTENT_TTL_MS = 24 * 60 * 60_000;

/**
 * Kaspi.kz напрямую, по протоколу провайдера. Гость открывает в Kaspi
 * «Платежи» → Cyber Fox, вводит свой номер телефона и сумму. Kaspi спрашивает
 * check — есть ли гость, затем pay — и мы зачисляем деньги на его счёт теми же
 * правилами, что и любое онлайн-пополнение.
 *
 * Сеть узнаётся по адресу (у каждой свой токен), запрос — только с адресов
 * Kaspi. txn_id уникален: повтор получает прежний ответ, а не второе зачисление.
 */
@Injectable()
export class KaspiProviderService {
  private readonly logger = new Logger(KaspiProviderService.name);
  private readonly allowedIps: string[];
  /** Сумма в ответе check, тиын. По умолчанию 0 — «любая сумма». */
  private readonly checkSum: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    config: ConfigService,
  ) {
    this.allowedIps = parseAllowedIps(config.get<string>("KASPI_ALLOWED_IPS"));
    this.checkSum = parseSum(config.get<string>("KASPI_CHECK_SUM")) ?? 0;
  }

  // --- Настройки (владелец сети) ---

  async get(staff: AuthenticatedStaff): Promise<PublicKaspiProvider> {
    const channel = await this.prisma.kaspiProviderChannel.findUnique({ where: { tenantId: staff.tenantId } });
    return {
      connected: channel !== null,
      enabled: channel?.enabled ?? false,
      path: channel ? `/api/payments/kaspi/${channel.token}` : null,
      accountRegex: KASPI_ACCOUNT_REGEX,
      allowedIps: this.allowedIps,
      bin: channel?.bin ?? null,
    };
  }

  /** bin не передан — не трогаем; пустая строка — убрать. */
  async save(staff: AuthenticatedStaff, enabled: boolean, rawBin?: string): Promise<PublicKaspiProvider> {
    const data: { enabled: boolean; bin?: string | null } = { enabled };
    if (rawBin !== undefined) {
      const bin = parseBin(rawBin);
      if (bin === undefined) throw new BadRequestException("БИН/ИИН — 12 цифр");
      data.bin = bin;
    }
    await this.prisma.kaspiProviderChannel.upsert({
      where: { tenantId: staff.tenantId },
      create: { tenantId: staff.tenantId, ...data },
      update: data,
    });
    return this.get(staff);
  }

  // --- Запросы Kaspi ---

  async handle(token: string, ip: string | undefined, query: Record<string, unknown>): Promise<KaspiReply> {
    if (!isAllowedIp(ip, this.allowedIps)) {
      this.logger.warn(`Запрос Kaspi с чужого адреса ${ip ?? "?"}`);
      throw new ForbiddenException();
    }
    const channel = await this.prisma.kaspiProviderChannel.findUnique({ where: { token } });
    if (!channel) {
      this.logger.warn(`Запрос Kaspi с неизвестным адресом сервиса (ip ${ip ?? "?"})`);
      throw new NotFoundException();
    }
    const reply = withBin(await this.reply(channel.tenantId, channel.enabled, query), channel.bin);
    // Каждый запрос — строка в журнале: так видно, дошёл ли Kaspi и что ему ответили.
    const one = (key: string): string => String([query[key]].flat()[0] ?? "").slice(0, 40);
    this.logger.log(
      `Kaspi ${one("command") || "?"} txn=${one("txn_id") || "?"} account=${one("account") || "?"} ` +
        `sum=${one("sum") || "?"} ip=${ip ?? "?"} → result=${reply.result}` +
        (reply.comment ? ` (${reply.comment})` : ""),
    );
    return reply;
  }

  private async reply(tenantId: string, enabled: boolean, query: Record<string, unknown>): Promise<KaspiReply> {
    const str = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
    const txnId = parseTxnId(str("txn_id"));
    if (!txnId) return buildReply({ txnId: str("txn_id") ?? "", result: KaspiResult.OTHER, comment: "Неверный txn_id" });
    if (!enabled) {
      return buildReply({ txnId, result: KaspiResult.OTHER, comment: "Приём платежей временно отключён" });
    }

    try {
      switch (str("command")) {
        case "check":
          return await this.check(tenantId, txnId, str("account"));
        case "pay":
          return await this.pay(tenantId, txnId, str("account"), str("sum"), str("txn_date"));
        default:
          return buildReply({ txnId, result: KaspiResult.OTHER, comment: "Неизвестная команда" });
      }
    } catch (error) {
      // Код 5 Kaspi повторит позже; txn_id при этом не занят — повтор пройдёт заново.
      this.logger.error(`Kaspi ${str("command")} ${txnId}: ${(error as Error).message}`);
      return buildReply({ txnId, result: KaspiResult.OTHER, comment: "Временная ошибка, повторите" });
    }
  }

  /**
   * Пополнение баланса: сумму гость вводит сам, обязательной суммы нет.
   * Kaspi просит поле sum и в ответе check — отдаём 0.00, «любая сумма»
   * (KASPI_CHECK_SUM задаёт другую, например 1.00 для теста Kaspi).
   */
  private async check(tenantId: string, txnId: string, account: string | undefined): Promise<KaspiReply> {
    const found = await this.findGuest(tenantId, account);
    if (!found) {
      return buildReply({ txnId, result: KaspiResult.NOT_FOUND, sum: this.checkSum, comment: "Гость с таким номером не найден" });
    }
    return buildReply({ txnId, result: KaspiResult.OK, sum: this.checkSum, fields: this.fields(found.guest, found.club) });
  }

  private async pay(
    tenantId: string,
    txnId: string,
    account: string | undefined,
    rawSum: string | undefined,
    rawDate: string | undefined,
  ): Promise<KaspiReply> {
    const existing = await this.prisma.kaspiTxn.findUnique({ where: { txnId } });
    if (existing) return this.resume(existing, tenantId);

    const amount = parseSum(rawSum);
    if (amount === null) return buildReply({ txnId, result: KaspiResult.OTHER, comment: "Неверная сумма" });

    const found = await this.findGuest(tenantId, account);
    if (!found) {
      // Окончательный ответ запоминаем: повтор того же txn_id получит его же.
      await this.prisma.kaspiTxn
        .create({
          data: {
            tenantId,
            txnId,
            account: account ?? "",
            amount,
            txnDate: parseTxnDate(rawDate),
            result: KaspiResult.NOT_FOUND,
            comment: "Гость с таким номером не найден",
          },
        })
        .catch(() => undefined);
      return buildReply({ txnId, result: KaspiResult.NOT_FOUND, comment: "Гость с таким номером не найден" });
    }

    let txn: KaspiTxn;
    try {
      txn = await this.prisma.kaspiTxn.create({
        data: {
          tenantId,
          txnId,
          account: account ?? "",
          amount,
          txnDate: parseTxnDate(rawDate),
          guestId: found.guest.id,
        },
      });
    } catch (error) {
      // Параллельный повтор того же txn_id успел первым — продолжаем его запись.
      if ((error as { code?: string }).code !== "P2002") throw error;
      const raced = await this.prisma.kaspiTxn.findUniqueOrThrow({ where: { txnId } });
      return this.resume(raced, tenantId);
    }

    const intent = await this.prisma.paymentIntent.create({
      data: {
        tenantId,
        clubId: found.club.id,
        purpose: PaymentPurpose.GUEST_TOPUP,
        amount,
        guestId: found.guest.id,
        provider: "kaspi",
        providerRef: `kaspi:${txnId}`,
        idempotencyKey: `kaspi:${txnId}`,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });
    await this.prisma.kaspiTxn.update({ where: { id: txn.id }, data: { intentId: intent.id } });
    return this.finish({ ...txn, intentId: intent.id }, found.guest, found.club);
  }

  /** Повтор txn_id: окончательный ответ — как был; незавершённый — доводим. */
  private async resume(txn: KaspiTxn, tenantId: string): Promise<KaspiReply> {
    if (txn.tenantId !== tenantId) {
      return buildReply({ txnId: txn.txnId, result: KaspiResult.OTHER, comment: "txn_id уже использован" });
    }
    if (txn.result === KaspiResult.OK) {
      return buildReply({ txnId: txn.txnId, result: KaspiResult.OK, prvTxnId: txn.id, sum: txn.amount, comment: "OK" });
    }
    if (txn.result !== null) {
      return buildReply({ txnId: txn.txnId, result: txn.result as KaspiResultCode, comment: txn.comment ?? "" });
    }
    if (!txn.intentId || !txn.guestId) {
      // Запись создана, а платёж ещё нет: либо параллельный запрос прямо сейчас, либо сбой посередине.
      const intent = await this.ensureIntent(txn);
      if (!intent) return buildReply({ txnId: txn.txnId, result: KaspiResult.IN_PROGRESS, comment: "Платёж в обработке" });
      txn = { ...txn, intentId: intent };
    }
    const intent = await this.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: txn.intentId! },
      include: { guest: true, club: true },
    });
    return this.finish(txn, intent.guest!, intent.club!);
  }

  /** Довести запись без платежа, если она старше нескольких секунд (значит, не параллельный запрос, а сбой). */
  private async ensureIntent(txn: KaspiTxn): Promise<string | null> {
    if (Date.now() - txn.createdAt.getTime() < 20_000 || !txn.guestId) return null;
    const guest = await this.prisma.guest.findUniqueOrThrow({ where: { id: txn.guestId } });
    const club = await this.clubFor(guest);
    if (!club) return null;
    const intent = await this.prisma.paymentIntent.upsert({
      where: { idempotencyKey: `kaspi:${txn.txnId}` },
      create: {
        tenantId: txn.tenantId,
        clubId: club.id,
        purpose: PaymentPurpose.GUEST_TOPUP,
        amount: txn.amount,
        guestId: guest.id,
        provider: "kaspi",
        providerRef: `kaspi:${txn.txnId}`,
        idempotencyKey: `kaspi:${txn.txnId}`,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
      update: {},
    });
    await this.prisma.kaspiTxn.update({ where: { id: txn.id }, data: { intentId: intent.id } });
    return intent.id;
  }

  /** Зачисление теми же правилами, что и любое онлайн-пополнение: дубль не зачисляется. */
  private async finish(txn: KaspiTxn, guest: Guest, club: Club): Promise<KaspiReply> {
    const result = await this.payments.confirm(`kaspi:${txn.txnId}`, { paid: true, amount: txn.amount });
    const intent = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: txn.intentId! } });
    if (intent.status !== PaymentIntentStatus.SUCCEEDED) {
      // Сюда попадают только расхождения, которые разбирает человек; Kaspi пусть повторит позже.
      throw new Error(result.reason ?? "Платёж не зачислен");
    }
    await this.prisma.kaspiTxn.update({ where: { id: txn.id }, data: { result: KaspiResult.OK, comment: "OK" } });
    return buildReply({
      txnId: txn.txnId,
      result: KaspiResult.OK,
      prvTxnId: txn.id,
      sum: txn.amount,
      comment: "OK",
      fields: this.fields(guest, club),
    });
  }

  private fields(guest: Guest, club: Club): Array<[string, string]> {
    return [
      ["Гость", maskGuestName(guest.fullName)],
      ["Клуб", club.name],
    ];
  }

  private async findGuest(tenantId: string, account: string | undefined): Promise<{ guest: Guest; club: Club } | null> {
    const phone = accountToPhone(account);
    if (!phone) return null;
    const guest = await this.guestByPhone(tenantId, phone);
    if (!guest) return null;
    const club = await this.clubFor(guest);
    return club ? { guest, club } : null;
  }

  /**
   * Номер в базе записан так, как его ввели: касса хранит «+77…», регистрация
   * за ПК — «77…», бывает и «8 777 …» с пробелами. Сравниваем только цифры,
   * иначе гость, заведённый на кассе, для Kaspi «не найден».
   */
  private async guestByPhone(tenantId: string, phone: string): Promise<Guest | null> {
    const exact = await this.prisma.guest.findFirst({
      where: { tenantId, phone: { in: [phone, `+${phone}`] } },
      orderBy: { createdAt: "asc" },
    });
    if (exact) return exact;
    const local = phone.slice(1);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Guest"
      WHERE "tenantId" = ${tenantId}
        AND regexp_replace("phone", '[^0-9]', '', 'g') IN (${phone}, ${`8${local}`}, ${local})
      ORDER BY "createdAt" ASC
      LIMIT 1`;
    return rows[0] ? this.prisma.guest.findUnique({ where: { id: rows[0].id } }) : null;
  }

  /**
   * Касса, в которую ляжет платёж: клуб последнего визита гостя. При общем
   * кошельке сети это влияет только на отчёт кассы; при раздельных — на то,
   * в каком клубе пополнится баланс. Гость без визитов — первый клуб сети.
   */
  private async clubFor(guest: Guest): Promise<Club | null> {
    const last = await this.prisma.session.findFirst({
      where: { guestId: guest.id },
      orderBy: { startedAt: "desc" },
      select: { club: true },
    });
    if (last) return last.club;
    return this.prisma.club.findFirst({ where: { tenantId: guest.tenantId }, orderBy: { createdAt: "asc" } });
  }
}
