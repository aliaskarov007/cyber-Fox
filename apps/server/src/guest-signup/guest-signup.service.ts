import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";

import { normalizePhone, phoneTail } from "../common/phone.js";
import { consentText } from "../guests/consent.rules.js";
import { ConsentService } from "../guests/consent.service.js";
import { findGuestByPhone } from "../guests/guest-lookup.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  CODE_TTL_MINUTES,
  type IncomingMessage,
  extractCode,
  isStop,
  newCode,
  waLink,
} from "./whatsapp.rules.js";

/** Сколько регистраций подряд можно начать с одного ПК за десять минут. */
const MAX_ATTEMPTS_PER_COMPUTER = 5;
/**
 * Сколько после регистрации гость может ответить на вопрос о согласии. Позже
 * вопрос задаётся уже на стойке: ответить за чужой аккаунт с этого ПК нельзя.
 */
const CONSENT_WINDOW_MINUTES = 30;
/**
 * Без WhatsApp первый PIN аккаунту, заведённому на стойке без PIN, можно
 * задать за ПК только вскоре после заведения: дольше — и номер успеет узнать
 * кто-то ещё.
 */
const DESK_FIRST_PIN_HOURS = 2;

export type LookupResult =
  | { ok: true; phone: string; next: "PIN" | "REGISTER" }
  | { ok: false; reason: string };

export type RegisterResult =
  | {
      ok: true;
      /** Ждём сообщение с кодом в WhatsApp клуба. */
      mode: "WHATSAPP";
      verificationId: string;
      link: string;
      code: string;
      /** Номер клуба для тех, кто наберёт вручную. */
      businessNumber: string;
      expiresAt: Date;
    }
  /** WhatsApp не подключён: аккаунт готов сразу, номер ждёт стойки. */
  | { ok: true; mode: "DONE"; guestId: string; consentText: string; bonus: number }
  | { ok: false; reason: string };

export type StatusResult =
  | { state: "WAITING" }
  | { state: "EXPIRED" }
  | { state: "DONE"; guestId: string; consentText: string; bonus: number };

/**
 * Регистрация гостя прямо за игровым ПК.
 *
 * Гость вводит номер — сервер говорит, знаком ли номер. Знакомый входит по PIN,
 * новый придумывает PIN и подтверждает номер, отправив код с экрана в WhatsApp
 * клуба. Пока WhatsApp не подключён, аккаунт создаётся сразу, но номер считается
 * неподтверждённым до первого визита на стойку.
 */
@Injectable()
export class GuestSignupService {
  private readonly logger = new Logger(GuestSignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentService,
    private readonly config: ConfigService,
  ) {}

  /** Номер клуба в WhatsApp. Пусто — подтверждение через WhatsApp выключено. */
  private businessNumber(): string | null {
    const number = this.config.get<string>("WHATSAPP_NUMBER")?.trim();
    const secret = this.config.get<string>("WHATSAPP_APP_SECRET")?.trim();
    // Без ключа приложения входящие не проверить — значит, и ждать их нельзя.
    return number && secret ? number : null;
  }

  private async computer(computerId: string) {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true },
    });
    if (!computer) throw new NotFoundException("ПК не найден");
    return computer;
  }

  /** Первый шаг: номер знаком — PIN, незнаком или без PIN — регистрация. */
  async lookup(computerId: string, rawPhone: string): Promise<LookupResult> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return { ok: false, reason: "Проверьте номер телефона" };

    const computer = await this.computer(computerId);
    const guest = await findGuestByPhone(this.prisma, computer.club.tenantId, phone);
    const ready = guest?.pinHash && guest.phoneVerifiedAt;
    return { ok: true, phone, next: ready ? "PIN" : "REGISTER" };
  }

  /**
   * `viaDesk` — гость не смог подтвердить номер через WhatsApp (нет камеры,
   * нет WhatsApp, подключение у Meta ещё не заработало): аккаунт создаётся
   * сразу, номер подтвердит администратор. Застрять на экране с QR гость не должен.
   */
  async register(computerId: string, rawPhone: string, pin: string, viaDesk = false): Promise<RegisterResult> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return { ok: false, reason: "Проверьте номер телефона" };
    if (!/^\d{4}$/.test(pin)) return { ok: false, reason: "PIN — четыре цифры" };

    const computer = await this.computer(computerId);
    const tenantId = computer.club.tenantId;

    const existing = await findGuestByPhone(this.prisma, tenantId, phone);
    if (existing?.pinHash && existing.phoneVerifiedAt) {
      return { ok: false, reason: "Этот номер уже зарегистрирован — войдите по PIN" };
    }

    // Перебор номеров с одной машины — чтобы занять чужие или нагнать коды.
    const recent = await this.prisma.phoneVerification.count({
      where: { computerId, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
    });
    if (recent >= MAX_ATTEMPTS_PER_COMPUTER) {
      return { ok: false, reason: "Слишком много попыток. Подойдите к администратору." };
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const number = viaDesk ? null : this.businessNumber();

    if (number) {
      const code = newCode();
      const verification = await this.prisma.phoneVerification.create({
        data: {
          tenantId,
          clubId: computer.clubId,
          computerId,
          phone,
          code,
          pinHash,
          expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        },
      });
      return {
        ok: true,
        mode: "WHATSAPP",
        verificationId: verification.id,
        link: waLink(number, code),
        code,
        businessNumber: number,
        expiresAt: verification.expiresAt,
      };
    }

    /*
     * WhatsApp не подключён. Доказать, что номер его, гость не может, поэтому
     * аккаунт создаётся неподтверждённым: играть на нём нельзя, пока гость не
     * пополнит счёт на стойке, а там администратор его и подтвердит. Подарок за
     * согласие тоже ждёт этого момента.
     */
    if (existing) {
      const fresh =
        existing.phoneVerifiedAt &&
        !existing.pinHash &&
        existing.createdAt > new Date(Date.now() - DESK_FIRST_PIN_HOURS * 3_600_000);
      if (!fresh) {
        return {
          ok: false,
          reason: "Этот номер уже есть в базе. Подойдите к администратору, чтобы задать PIN.",
        };
      }
      await this.prisma.guest.update({ where: { id: existing.id }, data: { pinHash } });
      return {
        ok: true,
        mode: "DONE",
        guestId: existing.id,
        consentText: consentText(computer.club.consentBonus),
        bonus: computer.club.consentBonus,
      };
    }

    const guest = await this.prisma.guest.create({
      data: {
        tenantId,
        fullName: `Гость ${phoneTail(phone)}`,
        phone,
        pinHash,
        registeredClubId: computer.clubId,
      },
    });
    return {
      ok: true,
      mode: "DONE",
      guestId: guest.id,
      consentText: consentText(computer.club.consentBonus),
      bonus: computer.club.consentBonus,
    };
  }

  /** Экран ПК спрашивает, пришло ли сообщение. */
  async status(computerId: string, verificationId: string): Promise<StatusResult> {
    const verification = await this.prisma.phoneVerification.findUnique({
      where: { id: verificationId },
    });
    if (!verification || verification.computerId !== computerId) return { state: "EXPIRED" };
    if (verification.verifiedAt && verification.guestId) {
      const club = await this.prisma.club.findUniqueOrThrow({ where: { id: verification.clubId } });
      return {
        state: "DONE",
        guestId: verification.guestId,
        consentText: consentText(club.consentBonus),
        bonus: club.consentBonus,
      };
    }
    if (verification.expiresAt < new Date()) return { state: "EXPIRED" };
    return { state: "WAITING" };
  }

  /**
   * Ответ на вопрос о согласии сразу после регистрации.
   *
   * Отвечать можно только за аккаунт, только что зарегистрированный на этом же
   * ПК: иначе с любой машины можно было бы подписать кого угодно.
   */
  async answerConsent(
    computerId: string,
    guestId: string,
    accept: boolean,
  ): Promise<{ ok: boolean; bonus: number; reason?: string }> {
    const computer = await this.computer(computerId);
    const since = new Date(Date.now() - CONSENT_WINDOW_MINUTES * 60_000);

    const verified = await this.prisma.phoneVerification.findFirst({
      where: { computerId, guestId, verifiedAt: { gt: since } },
    });
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    const registeredHere =
      guest !== null &&
      guest.registeredClubId === computer.clubId &&
      guest.createdAt > since;
    if (!guest || (!verified && !registeredHere)) {
      return { ok: false, bonus: 0, reason: "Время ответа истекло. Подписаться можно у администратора." };
    }

    // Отказ ничего не записывает: спросить снова можно позже, на стойке.
    if (!accept) return { ok: true, bonus: 0 };
    return { ok: true, bonus: await this.consents.give(guestId, computer.clubId, "AGENT") };
  }

  /**
   * Входящее сообщение WhatsApp: код подтверждения или «СТОП».
   *
   * Номер отправителя WhatsApp удостоверяет сам — на этом и держится
   * подтверждение. Код при этом связывает сообщение с конкретным экраном.
   */
  async handleIncoming(message: IncomingMessage): Promise<void> {
    const phone = normalizePhone(message.from);
    if (!phone) return;

    if (isStop(message.text)) {
      const count = await this.consents.optOutByPhone(phone);
      this.logger.log(`Отписка из WhatsApp: ${count} аккаунт(ов)`);
      return;
    }

    const code = extractCode(message.text);
    if (!code) return;

    const verification = await this.prisma.phoneVerification.findFirst({
      where: { phone, code, verifiedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    // Код набран с другого номера или просрочен — молчим: ответ платный, а
    // гость и так видит на экране, что подтверждение не пришло.
    if (!verification) return;

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const existing = await findGuestByPhone(tx, verification.tenantId, phone);

      /*
       * Номер уже был в базе — неподтверждённый, без PIN или с PIN, который
       * гость забыл. Владелец номера доказал, что номер его: аккаунт со всеми
       * деньгами остаётся, PIN становится новым.
       */
      const guest = existing
        ? await tx.guest.update({
            where: { id: existing.id },
            data: {
              phone,
              pinHash: verification.pinHash,
              failedPinAttempts: 0,
              pinLockedUntil: null,
              phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
            },
          })
        : await tx.guest.create({
            data: {
              tenantId: verification.tenantId,
              fullName: `Гость ${phoneTail(phone)}`,
              phone,
              pinHash: verification.pinHash,
              phoneVerifiedAt: now,
              registeredClubId: verification.clubId,
            },
          });

      await tx.phoneVerification.update({
        where: { id: verification.id },
        data: { verifiedAt: now, guestId: guest.id },
      });

      // Согласие, данное раньше без подтверждённого номера, получает подарок сейчас.
      await this.consents.grantBonus(tx, guest.id, verification.clubId);
    });
  }
}
