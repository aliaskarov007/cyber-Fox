import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { StaffRole, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

import { PrismaService } from "../prisma/prisma.service.js";
import { PLANS } from "../billing-platform/subscription.rules.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Обзор платформы: все сети, их подписки и жизнь.
 *
 * Отвечает на вопросы, которые задаёт продавец, а не администратор зала: кто
 * зарегистрировался и не вернулся, у кого кончается пробный период, кто платит,
 * где сколько машин на связи.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string; name: string }> {
    const admin = await this.prisma.platformAdmin.findFirst({
      where: { email: email.toLowerCase().trim(), isActive: true },
    });
    const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
    if (!admin || !ok) throw new UnauthorizedException("Неверный адрес или пароль");

    return {
      accessToken: await this.jwt.signAsync({ sub: admin.id, platform: true }),
      name: admin.fullName,
    };
  }

  /** Все сети с тем, что нужно решать: деньги, сроки, признаки жизни. */
  async tenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        subscription: true,
        clubs: { select: { id: true, name: true, city: true } },
      },
    });

    return Promise.all(
      tenants.map(async (tenant) => {
        const clubIds = tenant.clubs.map((club) => club.id);

        const [computers, online, guests, lastSession] = await Promise.all([
          this.prisma.computer.count({ where: { clubId: { in: clubIds } } }),
          this.prisma.computer.count({
            where: { clubId: { in: clubIds }, lastSeenAt: { gte: new Date(Date.now() - 10 * 60_000) } },
          }),
          this.prisma.guest.count({ where: { tenantId: tenant.id } }),
          this.prisma.session.findFirst({
            where: { clubId: { in: clubIds } },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true },
          }),
        ]);

        return {
          id: tenant.id,
          name: tenant.name,
          createdAt: tenant.createdAt,
          clubs: tenant.clubs,
          plan: tenant.subscription?.plan ?? null,
          status: tenant.subscription?.status ?? null,
          maxComputers: tenant.subscription?.maxComputers ?? null,
          trialEndsAt: tenant.subscription?.trialEndsAt ?? null,
          graceEndsAt: tenant.subscription?.graceEndsAt ?? null,
          computers,
          // «На связи» считаем по последним десяти минутам: зал, выключенный на
          // ночь, не должен выглядеть отвалившимся клиентом.
          online,
          guests,
          lastSessionAt: lastSession?.startedAt ?? null,
        };
      }),
    );
  }

  /** Завести клуб самому: продавец подключает зал, не заставляя владельца регистрироваться. */
  async createTenant(dto: {
    networkName: string;
    clubName: string;
    city?: string;
    ownerName: string;
    email: string;
    password: string;
  }) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.staff.findFirst({ where: { email } });
    if (exists) throw new BadRequestException("Сотрудник с таким адресом уже есть");

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.networkName.trim() } });
      const club = await tx.club.create({
        data: { tenantId: tenant.id, name: dto.clubName.trim(), city: dto.city?.trim() || null },
      });
      // Зона нужна сразу: без неё нельзя завести ни машину, ни тариф.
      await tx.zone.create({ data: { clubId: club.id, name: "Основной зал" } });

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan: SubscriptionPlan.TRIAL,
          status: SubscriptionStatus.TRIALING,
          maxComputers: PLANS.TRIAL.maxComputers,
          trialEndsAt: new Date(Date.now() + 14 * DAY_MS),
        },
      });

      const owner = await tx.staff.create({
        data: {
          tenantId: tenant.id,
          clubId: null,
          email,
          fullName: dto.ownerName.trim(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: StaffRole.OWNER,
        },
      });

      return { tenantId: tenant.id, clubId: club.id, ownerId: owner.id };
    });
  }

  /** Продлить пробный период, сменить тариф, поднять лимит, приостановить. */
  async updateSubscription(
    tenantId: string,
    dto: { plan?: SubscriptionPlan; status?: SubscriptionStatus; maxComputers?: number; trialDays?: number },
  ) {
    const subscription = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!subscription) throw new NotFoundException("Подписка не найдена");

    return this.prisma.subscription.update({
      where: { tenantId },
      data: {
        plan: dto.plan,
        status: dto.status,
        maxComputers: dto.maxComputers,
        // Продление считается от сегодня, а не от прежнего срока: продлевают
        // обычно тогда, когда он уже вышел.
        trialEndsAt: dto.trialDays ? new Date(Date.now() + dto.trialDays * DAY_MS) : undefined,
      },
    });
  }
}
