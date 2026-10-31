import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service.js";
import {
  type GreenApiCredentials,
  GreenApiClient,
  type SendResult,
} from "./green-api.client.js";
import { WhatsAppService } from "./whatsapp.service.js";
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_MS,
  CODE_TTL_MS,
  checkCode,
  maskPhone,
  normalizePhone,
  passwordResetMessage,
} from "./whatsapp.rules.js";

/** Хеш привязан к сотруднику: одинаковый код у двоих даёт разные хеши. */
function hashCode(staffId: string, code: string): string {
  return createHash("sha256").update(`reset:${staffId}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type ResetConfirmResult = { ok: true } | { ok: false; error: string };

/**
 * Сброс забытого пароля сотрудника кодом в WhatsApp.
 *
 * Почтового канала у системы нет, а WhatsApp уже подключён: код уходит на
 * номер, указанный в карточке сотрудника. Пишет системный номер CyberFox
 * (SYSTEM_WHATSAPP_*), а если он не настроен — WhatsApp самой сети.
 *
 * На запрос кода ответ всегда одинаковый, есть такой сотрудник или нет:
 * иначе форма превращается в способ узнать, кто работает в клубе.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly greenApi: GreenApiClient,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private systemChannel(): GreenApiCredentials | null {
    const instanceId = this.config
      .get<string>("SYSTEM_WHATSAPP_INSTANCE_ID")
      ?.trim();
    const apiToken = this.config
      .get<string>("SYSTEM_WHATSAPP_API_TOKEN")
      ?.trim();
    if (!instanceId || !apiToken) return null;
    const apiUrl =
      this.config.get<string>("SYSTEM_WHATSAPP_API_URL")?.trim() ||
      "https://api.green-api.com";
    return { apiUrl, instanceId, apiToken };
  }

  private send(
    tenantId: string,
    phone: string,
    message: string,
  ): Promise<SendResult> {
    const system = this.systemChannel();
    return system
      ? this.greenApi.sendText(system, phone, message)
      : this.whatsapp.send(tenantId, phone, message);
  }

  private findStaff(email: string) {
    return this.prisma.staff.findFirst({
      where: { email: email.toLowerCase().trim(), isActive: true },
    });
  }

  async request(email: string): Promise<{ sent: true }> {
    const staff = await this.findStaff(email);
    const phone = staff?.phone ? normalizePhone(staff.phone) : null;
    if (!staff || !phone) return { sent: true };

    const last = await this.prisma.staffPasswordReset.findFirst({
      where: { staffId: staff.id },
      orderBy: { createdAt: "desc" },
    });
    // Не чаще раза в минуту: WhatsApp блокирует номера, которые шлют пачками.
    if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_MS)
      return { sent: true };

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

    // Действует только последний отправленный код.
    await this.prisma.staffPasswordReset.updateMany({
      where: { staffId: staff.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const result = await this.send(
      staff.tenantId,
      phone,
      passwordResetMessage(code),
    );
    if (!result.ok) {
      this.logger.warn(
        `Код сброса пароля на ${maskPhone(phone)} не ушёл: ${result.error}`,
      );
      return { sent: true };
    }

    await this.prisma.staffPasswordReset.create({
      data: {
        staffId: staff.id,
        codeHash: hashCode(staff.id, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return { sent: true };
  }

  async confirm(
    email: string,
    code: string,
    password: string,
  ): Promise<ResetConfirmResult> {
    const staff = await this.findStaff(email);
    const record = staff
      ? await this.prisma.staffPasswordReset.findFirst({
          where: { staffId: staff.id },
          orderBy: { createdAt: "desc" },
        })
      : null;
    if (!staff || !record)
      return { ok: false, error: "Неверный код. Запросите новый" };

    const verdict = checkCode(
      record,
      sameHash(record.codeHash, hashCode(staff.id, code.trim())),
      new Date(),
    );

    // Ошибка — ответом, не исключением: исключение откатило бы счётчик попыток.
    switch (verdict) {
      case "used":
        return {
          ok: false,
          error: "Этот код уже не действует — запросите новый",
        };
      case "expired":
        return { ok: false, error: "Код просрочен — запросите новый" };
      case "locked":
        return {
          ok: false,
          error: "Слишком много ошибок — запросите новый код",
        };
      case "wrong": {
        const updated = await this.prisma.staffPasswordReset.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        const left = CODE_MAX_ATTEMPTS - updated.attempts;
        return {
          ok: false,
          error:
            left > 0
              ? `Неверный код. Осталось попыток: ${left}`
              : "Неверный код. Запросите новый",
        };
      }
      case "ok":
        break;
    }

    const now = new Date();
    await this.prisma.staffPasswordReset.update({
      where: { id: record.id },
      data: { consumedAt: now },
    });
    // Новый пароль выгоняет все открытые вкладки со старым входом.
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        tokenVersion: { increment: 1 },
      },
    });
    return { ok: true };
  }
}
