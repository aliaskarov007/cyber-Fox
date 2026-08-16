import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  InvoiceStatus,
  type Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  type AccessDecision,
  AccessLevel,
  GRACE_DAYS,
  PLANS,
  TRIAL_DAYS,
  canAddComputer,
  evaluateAccess,
  invoiceAmount,
} from "./subscription.rules.js";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Подписка сети. Создаётся при регистрации, но старые сети могли её не иметь. */
  async forTenant(tenantId: string): Promise<Subscription> {
    const existing = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (existing) return existing;

    return this.prisma.subscription.create({
      data: {
        tenantId,
        plan: SubscriptionPlan.TRIAL,
        status: SubscriptionStatus.TRIALING,
        maxComputers: PLANS.TRIAL.maxComputers,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
      },
    });
  }

  async access(tenantId: string): Promise<AccessDecision> {
    const subscription = await this.forTenant(tenantId);
    return evaluateAccess(subscription, new Date());
  }

  /**
   * Проверка перед действием, которое расширяет использование платформы.
   *
   * Идущие сессии не трогаем ни при каком статусе: гость заплатил клубу, и его
   * игра не должна зависеть от расчётов клуба с нами.
   */
  async assertCanStartSession(tenantId: string): Promise<void> {
    const decision = await this.access(tenantId);
    if (decision.level === AccessLevel.READ_ONLY) {
      throw new ForbiddenException(decision.message ?? "Подписка неактивна");
    }
  }

  async assertCanAddComputer(tenantId: string): Promise<void> {
    const subscription = await this.forTenant(tenantId);
    const computers = await this.prisma.computer.count({
      where: { club: { tenantId } },
    });

    const verdict = canAddComputer(subscription, computers);
    if (!verdict.allowed) throw new BadRequestException(verdict.message ?? "Лимит машин исчерпан");
  }

  /** Смена тарифа владельцем. */
  async changePlan(staff: AuthenticatedStaff, plan: SubscriptionPlan): Promise<Subscription> {
    const definition = PLANS[plan];
    if (!definition) throw new BadRequestException("Неизвестный тариф");
    if (plan === SubscriptionPlan.TRIAL) {
      throw new BadRequestException("Вернуться на пробный период нельзя");
    }

    const clubs = await this.prisma.club.count({ where: { tenantId: staff.tenantId } });
    if (!definition.multiClub && clubs > 1) {
      throw new BadRequestException(
        `Тариф «${definition.title}» рассчитан на один зал, а у вас ${clubs}. Выберите тариф для сети.`,
      );
    }

    const computers = await this.prisma.computer.count({ where: { club: { tenantId: staff.tenantId } } });
    if (computers > definition.maxComputers) {
      throw new BadRequestException(
        `На тарифе «${definition.title}» доступно ${definition.maxComputers} машин, а подключено ${computers}.`,
      );
    }

    const subscription = await this.forTenant(staff.tenantId);
    const periodEnd = new Date(Date.now() + 30 * DAY_MS);

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        plan,
        status: SubscriptionStatus.ACTIVE,
        maxComputers: definition.maxComputers,
        pricePerComputer: definition.pricePerComputer,
        currentPeriodEnd: periodEnd,
        graceEndsAt: null,
      },
    });

    await this.issueInvoice(staff.tenantId, updated, computers);
    return updated;
  }

  async invoices(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { issuedAt: "desc" },
      take: 24,
    });
  }

  /*
   * Отметки «оплачено» здесь нет намеренно. Счёт за подписку клуб платит нам,
   * поэтому закрывать его может только подтверждённый платёж
   * (PaymentsService.applySuccess) — иначе владелец отмечает свой же счёт
   * оплаченным и пользуется платформой бесплатно.
   */

  private async issueInvoice(
    tenantId: string,
    subscription: Subscription,
    computers: number,
  ) {
    const amount = invoiceAmount(subscription.plan, computers);
    if (amount <= 0) return null;

    return this.prisma.invoice.create({
      data: {
        tenantId,
        periodStart: new Date(),
        periodEnd: subscription.currentPeriodEnd ?? new Date(Date.now() + 30 * DAY_MS),
        computers,
        amount,
        dueAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });
  }

  /**
   * Ежедневная проверка сроков: выставить счёт, перевести в просрочку,
   * закрыть льготный период.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async refreshSubscriptions(): Promise<void> {
    const now = new Date();
    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
    });

    for (const subscription of subscriptions) {
      try {
        if (
          subscription.status === SubscriptionStatus.ACTIVE &&
          subscription.currentPeriodEnd &&
          subscription.currentPeriodEnd <= now
        ) {
          const computers = await this.prisma.computer.count({
            where: { club: { tenantId: subscription.tenantId } },
          });
          await this.issueInvoice(subscription.tenantId, subscription, computers);
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: SubscriptionStatus.PAST_DUE,
              graceEndsAt: new Date(now.getTime() + GRACE_DAYS * DAY_MS),
            },
          });
          this.logger.log(`Сеть ${subscription.tenantId}: выставлен счёт, начался льготный период`);
          continue;
        }

        if (
          subscription.status === SubscriptionStatus.PAST_DUE &&
          subscription.graceEndsAt &&
          subscription.graceEndsAt <= now
        ) {
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: SubscriptionStatus.SUSPENDED },
          });
          await this.prisma.invoice.updateMany({
            where: { tenantId: subscription.tenantId, status: InvoiceStatus.ISSUED },
            data: { status: InvoiceStatus.OVERDUE },
          });
          this.logger.warn(`Сеть ${subscription.tenantId}: льготный период кончился`);
        }
      } catch (error) {
        this.logger.error(`Не удалось обновить подписку ${subscription.id}`, error as Error);
      }
    }
  }
}
