import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsAppService } from "./whatsapp.service.js";
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_MS,
  CODE_TTL_MS,
  checkCode,
  codeMessage,
  normalizePhone,
} from "./whatsapp.rules.js";

/** Хеш привязан к гостю: одинаковый код у двух гостей даёт разные хеши. */
function hashCode(guestId: string, code: string): string {
  return createHash("sha256").update(`${guestId}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Подтверждение номера гостя кодом в WhatsApp.
 *
 * Гость называет код администратору на стойке. Так проверяется сразу и то,
 * что номер его, и то, что на нём есть WhatsApp, — а значит, приглашения
 * на ивенты дойдут до человека, а не уйдут в пустоту или постороннему.
 */
@Injectable()
export class PhoneVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private async requireGuest(staff: AuthenticatedStaff, clubId: string, guestId: string) {
    await this.access.requireClub(staff, clubId);
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.tenantId !== staff.tenantId) throw new NotFoundException("Гость не найден");
    return guest;
  }

  async sendCode(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
  ): Promise<{ sentTo: string; expiresAt: Date }> {
    const guest = await this.requireGuest(staff, clubId, guestId);

    const phone = normalizePhone(guest.phone);
    if (!phone) throw new BadRequestException("Номер гостя не разобран — исправьте его в карточке");

    const last = await this.prisma.phoneVerification.findFirst({
      where: { guestId },
      orderBy: { createdAt: "desc" },
    });
    if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_MS) {
      const wait = Math.ceil((CODE_RESEND_MS - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new BadRequestException(`Код уже отправлен. Повторно — через ${wait} с`);
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: staff.tenantId } });
    const code = String(randomInt(0, 10_000)).padStart(4, "0");

    // Прежние коды гасим: действовать должен только последний отправленный.
    await this.prisma.phoneVerification.updateMany({
      where: { guestId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const result = await this.whatsapp.send(staff.tenantId, phone, codeMessage(code, tenant.name));
    if (!result.ok) throw new BadRequestException(result.error);

    const record = await this.prisma.phoneVerification.create({
      data: {
        guestId,
        codeHash: hashCode(guestId, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    return { sentTo: phone, expiresAt: record.expiresAt };
  }

  async confirm(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
    code: string,
  ): Promise<{ ok: true; phoneVerifiedAt: Date } | { ok: false; error: string }> {
    await this.requireGuest(staff, clubId, guestId);

    const record = await this.prisma.phoneVerification.findFirst({
      where: { guestId },
      orderBy: { createdAt: "desc" },
    });
    if (!record) throw new BadRequestException("Сначала отправьте код");

    const matches = sameHash(record.codeHash, hashCode(guestId, code));
    const verdict = checkCode(record, matches, new Date());

    /*
     * Ошибка ввода возвращается ответом, а не исключением. Запрос сотрудника
     * идёт одной транзакцией, и исключение откатило бы счётчик попыток вместе
     * со всем остальным — четыре цифры тогда перебирались бы без ограничения.
     */
    switch (verdict) {
      case "used":
        return { ok: false, error: "Этот код уже не действует — отправьте новый" };
      case "expired":
        return { ok: false, error: "Код просрочен — отправьте новый" };
      case "locked":
        return { ok: false, error: "Слишком много ошибок — отправьте новый код" };
      case "wrong": {
        const updated = await this.prisma.phoneVerification.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        const left = CODE_MAX_ATTEMPTS - updated.attempts;
        return {
          ok: false,
          error: left > 0 ? `Неверный код. Осталось попыток: ${left}` : "Неверный код. Отправьте новый",
        };
      }
      case "ok":
        break;
    }

    const now = new Date();
    await this.prisma.phoneVerification.update({ where: { id: record.id }, data: { consumedAt: now } });
    await this.prisma.guest.update({ where: { id: guestId }, data: { phoneVerifiedAt: now } });
    return { ok: true, phoneVerifiedAt: now };
  }
}
