import { Injectable, Logger } from "@nestjs/common";
import { GuestSignupStatus, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

import { findGuestByPhone, storedPhone } from "../guests/guest-phone.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import {
  SIGNUP_TTL_MS,
  cleanNickname,
  makeSignupCode,
  normalizePhone,
  signupConfirmedMessage,
  signupLink,
} from "./whatsapp.rules.js";

export type SignupStart =
  | { ok: true; code: string; link: string; clubPhone: string; expiresAt: Date }
  | { ok: false; reason: string };

export type SignupComplete = { ok: true; phone: string } | { ok: false; reason: string };

/** После подтверждения у гостя есть столько времени, чтобы ввести ник и PIN. */
const COMPLETE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Регистрация гостя прямо за игровым ПК.
 *
 * 1. Экран показывает QR со ссылкой wa.me на номер клуба и кодом CF-XXXX.
 * 2. Гость сканирует, WhatsApp открывается с готовым сообщением, гость жмёт «Отправить».
 * 3. Green-API присылает сообщение; номер отправителя подставил сам WhatsApp,
 *    поэтому номер подтверждён без всякого кода в ответ.
 * 4. Экран просит ник и PIN — аккаунт готов, гость сразу входит.
 *
 * Если аккаунт с этим номером уже есть, новый не заводится: гость задаёт
 * новый PIN. Это заодно и «забыл PIN» без похода к стойке — номер он только
 * что доказал.
 */
@Injectable()
export class GuestSignupService {
  private readonly logger = new Logger(GuestSignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  async start(computerId: string): Promise<SignupStart> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true },
    });
    if (!computer) return { ok: false, reason: "ПК не найден" };

    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { tenantId: computer.club.tenantId },
    });
    if (!channel?.phone) {
      return {
        ok: false,
        reason: "Регистрация через WhatsApp в клубе не настроена. Подойдите к администратору.",
      };
    }

    // Один QR на машину: прежний, если гость ушёл не дождавшись, больше не действует.
    await this.prisma.guestSignup.deleteMany({
      where: { computerId, status: { not: GuestSignupStatus.COMPLETED } },
    });

    const expiresAt = new Date(Date.now() + SIGNUP_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeSignupCode((max) => randomInt(0, max));
      try {
        await this.prisma.guestSignup.create({
          data: {
            tenantId: computer.club.tenantId,
            clubId: computer.clubId,
            computerId,
            code,
            expiresAt,
          },
        });
        return {
          ok: true,
          code,
          link: signupLink(channel.phone, code, computer.club.name),
          clubPhone: channel.phone,
          expiresAt,
        };
      } catch (error) {
        // Совпал с чужим действующим кодом — берём другой.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    return { ok: false, reason: "Не удалось выдать код — попробуйте ещё раз" };
  }

  /**
   * Гость прислал код со своего номера. Возвращает текст ответа гостю
   * или null, если код чужой, просроченный или уже использован — тогда молчим.
   */
  async confirm(tenantId: string, code: string, senderPhone: string): Promise<string | null> {
    const signup = await this.prisma.guestSignup.findUnique({ where: { code } });
    if (!signup || signup.tenantId !== tenantId) return null;
    if (signup.status !== GuestSignupStatus.WAITING || signup.expiresAt <= new Date()) return null;

    const phone = normalizePhone(senderPhone);
    if (!phone) return null;

    const existing = await findGuestByPhone(this.prisma, tenantId, phone);
    const computer = await this.prisma.computer.findUnique({
      where: { id: signup.computerId },
      select: { name: true },
    });

    await this.prisma.guestSignup.update({
      where: { id: signup.id },
      data: {
        status: GuestSignupStatus.CONFIRMED,
        phone,
        guestId: existing?.id ?? null,
        confirmedAt: new Date(),
      },
    });

    this.bus.emit("signup.confirmed", {
      computerId: signup.computerId,
      code,
      existingName: existing?.fullName ?? null,
    });

    return signupConfirmedMessage(computer?.name ?? "своему ПК", existing?.fullName ?? null);
  }

  async complete(computerId: string, code: string, nickname: string, pin: string): Promise<SignupComplete> {
    const signup = await this.prisma.guestSignup.findUnique({ where: { code } });
    if (!signup || signup.computerId !== computerId || !signup.phone) {
      return { ok: false, reason: "Регистрация не найдена — начните заново" };
    }
    if (signup.status !== GuestSignupStatus.CONFIRMED) {
      return { ok: false, reason: "Номер ещё не подтверждён — отправьте сообщение в WhatsApp" };
    }
    if (!signup.confirmedAt || Date.now() - signup.confirmedAt.getTime() > COMPLETE_WINDOW_MS) {
      return { ok: false, reason: "Время вышло — начните регистрацию заново" };
    }
    if (!/^\d{4}$/.test(pin)) return { ok: false, reason: "PIN — четыре цифры" };

    const pinHash = await bcrypt.hash(pin, 10);
    const now = new Date();

    // Аккаунт мог появиться, пока гость вводил ник: у стойки, с соседнего ПК.
    const existing = signup.guestId
      ? await this.prisma.guest.findUnique({ where: { id: signup.guestId } })
      : await findGuestByPhone(this.prisma, signup.tenantId, signup.phone);

    let phone: string;
    if (existing) {
      await this.prisma.guest.update({
        where: { id: existing.id },
        data: {
          pinHash,
          failedPinAttempts: 0,
          pinLockedUntil: null,
          phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
        },
      });
      phone = existing.phone;
    } else {
      const name = cleanNickname(nickname);
      if (!name) return { ok: false, reason: "Ник — от 2 до 24 знаков" };
      const guest = await this.prisma.guest.create({
        data: {
          tenantId: signup.tenantId,
          fullName: name,
          phone: storedPhone(signup.phone),
          pinHash,
          phoneVerifiedAt: now,
        },
      });
      phone = guest.phone;
      this.logger.log(`Гость зарегистрировался сам за ПК ${computerId}`);
    }

    await this.prisma.guestSignup.update({
      where: { id: signup.id },
      data: { status: GuestSignupStatus.COMPLETED, completedAt: now, guestId: existing?.id ?? signup.guestId },
    });

    return { ok: true, phone };
  }
}
