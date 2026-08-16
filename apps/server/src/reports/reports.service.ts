import { ForbiddenException, Injectable } from "@nestjs/common";
import { StaffRole, TransactionType } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { toLocalMoment } from "../common/local-time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  type ClubMoneyFlow,
  type ComputerPerformance,
  type HourlyPoint,
  type Settlement,
  computeSettlement,
  fillHours,
  rankComputers,
} from "./reports.rules.js";

export interface Period {
  from: Date;
  to: Date;
}

/** Приход денег в кассу зала. */
const COLLECTING_TYPES: TransactionType[] = [TransactionType.TOPUP];

/** Заработок зала: то, за что гость реально заплатил здесь. */
const EARNING_TYPES: TransactionType[] = [
  TransactionType.SESSION_CHARGE,
  TransactionType.PRODUCT_SALE,
  TransactionType.PACKAGE_PURCHASE,
  TransactionType.REFUND,
];

export interface ClubSummary {
  clubId: string;
  clubName: string;
  revenue: number;
  sessionsRevenue: number;
  productsRevenue: number;
  productsMargin: number;
  sessionsCount: number;
  busyMinutes: number;
  computers: number;
  /** Доля занятого времени от всех машин зала за период. */
  occupancy: number;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
  ) {}

  /** Сводка по всем залам сети: то, ради чего владельцу нужна облачная версия. */
  async network(staff: AuthenticatedStaff, period: Period): Promise<ClubSummary[]> {
    const clubs = await this.access.listAccessibleClubs(staff);
    const periodMinutes = Math.max(1, (period.to.getTime() - period.from.getTime()) / 60_000);

    return Promise.all(
      clubs.map(async (club) => {
        const [charges, sales, segments, computers] = await Promise.all([
          this.prisma.transaction.findMany({
            where: {
              clubId: club.id,
              type: TransactionType.SESSION_CHARGE,
              createdAt: { gte: period.from, lte: period.to },
            },
            select: { amount: true, sessionId: true },
          }),
          this.prisma.productSale.findMany({
            where: { clubId: club.id, createdAt: { gte: period.from, lte: period.to } },
            select: { total: true, costAtSale: true, quantity: true },
          }),
          this.prisma.sessionSegment.findMany({
            where: {
              session: { clubId: club.id },
              startedAt: { gte: period.from, lte: period.to },
            },
            select: { minutesUsed: true, charged: true, sessionId: true },
          }),
          this.prisma.computer.count({ where: { clubId: club.id } }),
        ]);

        // Выручка от времени берётся по списаниям, а минуты — по отрезкам:
        // минуты пакета денег не двигают, но машину занимают.
        const sessionsRevenue = charges.reduce((sum, t) => sum - t.amount, 0);
        const productsRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const productsCost = sales.reduce((sum, s) => sum + s.costAtSale * s.quantity, 0);
        const busyMinutes = segments.reduce((sum, s) => sum + s.minutesUsed, 0);

        return {
          clubId: club.id,
          clubName: club.name,
          revenue: sessionsRevenue + productsRevenue,
          sessionsRevenue,
          productsRevenue,
          productsMargin: productsRevenue - productsCost,
          sessionsCount: new Set(segments.map((s) => s.sessionId)).size,
          busyMinutes,
          computers,
          occupancy:
            computers > 0 ? Math.min(1, busyMinutes / (computers * periodMinutes)) : 0,
        };
      }),
    );
  }

  /** Прибыльность машин зала: что окупается, а что простаивает. */
  async computers(
    staff: AuthenticatedStaff,
    clubId: string,
    period: Period,
  ): Promise<ComputerPerformance[]> {
    await this.access.requireClub(staff, clubId);
    const periodMinutes = Math.max(1, (period.to.getTime() - period.from.getTime()) / 60_000);

    const sessions = await this.prisma.session.findMany({
      where: { clubId, startedAt: { gte: period.from, lte: period.to } },
      select: {
        id: true,
        computerId: true,
        computer: { select: { name: true, zone: { select: { name: true } } } },
        segments: { select: { minutesUsed: true, charged: true } },
      },
    });

    const byComputer = new Map<
      string,
      { computerName: string; zoneName: string; revenue: number; minutes: number; sessions: number }
    >();

    for (const session of sessions) {
      const entry = byComputer.get(session.computerId) ?? {
        computerName: session.computer.name,
        zoneName: session.computer.zone.name,
        revenue: 0,
        minutes: 0,
        sessions: 0,
      };
      entry.sessions += 1;
      for (const segment of session.segments) {
        entry.revenue += segment.charged;
        entry.minutes += segment.minutesUsed;
      }
      byComputer.set(session.computerId, entry);
    }

    return rankComputers(
      [...byComputer.entries()].map(([computerId, e]) => ({ computerId, ...e })),
      periodMinutes,
    );
  }

  /** Часы пик по местному времени зала. */
  async hours(
    staff: AuthenticatedStaff,
    clubId: string,
    period: Period,
  ): Promise<HourlyPoint[]> {
    const club = await this.access.requireClub(staff, clubId);

    const charges = await this.prisma.transaction.findMany({
      where: {
        clubId,
        type: TransactionType.SESSION_CHARGE,
        createdAt: { gte: period.from, lte: period.to },
      },
      select: { amount: true, sessionId: true, createdAt: true },
    });

    const byHour = new Map<number, { revenue: number; sessions: Set<string> }>();
    for (const charge of charges) {
      // Час считается по времени зала, а не сервера: иначе пик уезжает
      // на разницу поясов и отчёт врёт.
      const hour = Math.floor(toLocalMoment(charge.createdAt, club.timezone).minuteOfDay / 60);
      const entry = byHour.get(hour) ?? { revenue: 0, sessions: new Set<string>() };
      entry.revenue -= charge.amount;
      if (charge.sessionId) entry.sessions.add(charge.sessionId);
      byHour.set(hour, entry);
    }

    return fillHours(
      [...byHour.entries()].map(([hour, e]) => ({
        hour,
        revenue: e.revenue,
        sessions: e.sessions.size,
      })),
    );
  }

  /**
   * Взаимозачёт между залами. Имеет смысл только при общем кошельке: иначе
   * пополнение и расход всегда в одном клубе и разницы не возникает.
   */
  async settlement(
    staff: AuthenticatedStaff,
    period: Period,
  ): Promise<Settlement & { sharedBalance: boolean }> {
    if (staff.role !== StaffRole.OWNER) {
      throw new ForbiddenException("Взаимозачёт по сети видит владелец");
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: staff.tenantId } });
    const clubs = await this.prisma.club.findMany({ where: { tenantId: staff.tenantId } });

    const flows: ClubMoneyFlow[] = await Promise.all(
      clubs.map(async (club) => {
        const transactions = await this.prisma.transaction.findMany({
          where: {
            clubId: club.id,
            createdAt: { gte: period.from, lte: period.to },
            // Только движения реальных денег. Служебные проводки —
            // перенос остатков при смене настройки кошелька, ручные
            // корректировки, бонусы — не выручка зала и не приход в кассу.
            type: { in: [...COLLECTING_TYPES, ...EARNING_TYPES] },
          },
          select: { type: true, amount: true },
        });

        return {
          clubId: club.id,
          clubName: club.name,
          collected: transactions
            .filter((t) => COLLECTING_TYPES.includes(t.type))
            .reduce((sum, t) => sum + t.amount, 0),
          // Списания хранятся отрицательными; возврат уменьшает заработок.
          consumed: transactions
            .filter((t) => EARNING_TYPES.includes(t.type))
            .reduce((sum, t) => sum - t.amount, 0),
        };
      }),
    );

    return { ...computeSettlement(flows), sharedBalance: tenant.sharedBalance };
  }
}
