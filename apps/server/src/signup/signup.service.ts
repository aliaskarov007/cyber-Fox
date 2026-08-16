import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { StaffRole, SubscriptionPlan, SubscriptionStatus, TariffKind } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { AuthService, type LoginResult } from "../auth/auth.service.js";
import { PLANS, TRIAL_DAYS } from "../billing-platform/subscription.rules.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { SignupDto } from "./signup.dto.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Самостоятельная регистрация клуба.
 *
 * Смысл этапа продаж: чужой владелец должен запустить систему без нашего
 * участия. Поэтому регистрация создаёт не пустую оболочку, а готовый к работе
 * зал — с зоной, тарифом и машинами, чтобы первую сессию можно было открыть
 * сразу после установки агента.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async signup(dto: SignupDto): Promise<LoginResult & { clubId: string }> {
    const email = dto.email.toLowerCase().trim();

    // Адрес уникален в пределах сети, но для входа он должен быть уникален
    // и глобально: иначе форма входа не поймёт, в какую сеть пускать.
    const existing = await this.prisma.staff.findFirst({ where: { email } });
    if (existing) {
      throw new BadRequestException("Этот адрес уже зарегистрирован");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.networkName?.trim() || dto.clubName.trim() },
      });

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan: SubscriptionPlan.TRIAL,
          status: SubscriptionStatus.TRIALING,
          maxComputers: PLANS.TRIAL.maxComputers,
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
        },
      });

      const club = await tx.club.create({
        data: {
          tenantId: tenant.id,
          name: dto.clubName.trim(),
          city: dto.city?.trim() || null,
          timezone: dto.timezone?.trim() || "Asia/Almaty",
        },
      });

      // Зал без зоны и тарифа не может открыть ни одной сессии, поэтому
      // заготовку делаем сразу — владелец переименует и поправит цену.
      const zone = await tx.zone.create({
        data: { clubId: club.id, name: "Основной зал", sortOrder: 1 },
      });

      const tariff = await tx.tariff.create({
        data: {
          clubId: club.id,
          zoneId: zone.id,
          name: "Поминутно",
          kind: TariffKind.PER_MINUTE,
          pricePerMinute: dto.pricePerMinute ?? 1_000,
        },
      });

      await tx.zone.update({
        where: { id: zone.id },
        data: { defaultPerMinuteTariffId: tariff.id },
      });

      // Машины заводим сразу с кодами привязки: остаётся установить агента.
      const computers = Math.min(dto.computers ?? 0, PLANS.TRIAL.maxComputers);
      for (let i = 1; i <= computers; i++) {
        await tx.computer.create({
          data: {
            clubId: club.id,
            zoneId: zone.id,
            name: `ПК-${String(i).padStart(2, "0")}`,
            pairingToken: randomBytes(16).toString("hex"),
          },
        });
      }

      await tx.staff.create({
        data: {
          tenantId: tenant.id,
          // Владелец сети не привязан к залу: пустой клуб открывает ему всё.
          clubId: null,
          email,
          fullName: dto.ownerName.trim(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: StaffRole.OWNER,
        },
      });

      return { tenant, club };
    });

    this.logger.log(`Зарегистрирован клуб «${created.club.name}» (сеть ${created.tenant.id})`);

    return {
      ...(await this.auth.login(email, dto.password)),
      clubId: created.club.id,
    };
  }
}
