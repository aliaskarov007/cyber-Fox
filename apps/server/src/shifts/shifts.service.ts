import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, type Shift, TransactionType } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type Reconciliation, computeShiftTotals, reconcile } from "./shift.rules.js";

export interface ShiftReport {
  shift: Shift;
  staffName: string;
  cashExpected: number;
  cardTotal: number;
  balanceTotal: number;
  revenue: number;
  sessionsRevenue: number;
  productsRevenue: number;
  productsCost: number;
  topUpsTotal: number;
  sessionsCount: number;
  reconciliation: Reconciliation | null;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
  ) {}

  /** Открытая смена клуба, если она есть. Кассовый экран показывает её в шапке. */
  async current(staff: AuthenticatedStaff, clubId: string): Promise<Shift | null> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.shift.findFirst({
      where: { clubId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
  }

  async open(
    staff: AuthenticatedStaff,
    clubId: string,
    openingFloat: number,
  ): Promise<Shift> {
    await this.access.requireClub(staff, clubId);

    // Две открытые смены в одном зале не сверить: непонятно, чья касса.
    const existing = await this.prisma.shift.findFirst({
      where: { clubId, closedAt: null },
    });
    if (existing) throw new BadRequestException("В клубе уже открыта смена");

    return this.prisma.shift.create({
      data: { clubId, staffId: staff.id, openingFloat },
    });
  }

  /**
   * Закрытие смены. Расхождение не мешает закрыться и не правится автоматически:
   * недостача — факт, который фиксируют и разбирают, а не прячут.
   */
  async close(
    staff: AuthenticatedStaff,
    clubId: string,
    shiftId: string,
    cashCounted: number,
    note?: string,
  ): Promise<ShiftReport> {
    await this.access.requireClub(staff, clubId);
    const shift = await this.requireShift(clubId, shiftId);
    if (shift.closedAt) throw new BadRequestException("Смена уже закрыта");

    const report = await this.buildReport(shift);

    const closed = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        cashExpected: report.cashExpected,
        cashCounted,
        note: note ?? null,
      },
    });

    return {
      ...report,
      shift: closed,
      reconciliation: reconcile(report.cashExpected, cashCounted),
    };
  }

  /** Отчёт по смене: открытой — на текущий момент, закрытой — итоговый. */
  async report(
    staff: AuthenticatedStaff,
    clubId: string,
    shiftId: string,
  ): Promise<ShiftReport> {
    await this.access.requireClub(staff, clubId);
    const shift = await this.requireShift(clubId, shiftId);
    const report = await this.buildReport(shift);

    return {
      ...report,
      reconciliation:
        shift.closedAt && shift.cashCounted !== null
          ? reconcile(shift.cashExpected ?? report.cashExpected, shift.cashCounted)
          : null,
    };
  }

  async list(staff: AuthenticatedStaff, clubId: string): Promise<Shift[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.shift.findMany({
      where: { clubId },
      orderBy: { openedAt: "desc" },
      take: 30,
    });
  }

  private async buildReport(shift: Shift): Promise<Omit<ShiftReport, "reconciliation">> {
    const until = shift.closedAt ?? new Date();
    const window = { gte: shift.openedAt, lte: until };

    const [payments, sales, staffRecord] = await Promise.all([
      this.prisma.payment.findMany({ where: { shiftId: shift.id } }),
      this.prisma.productSale.findMany({ where: { shiftId: shift.id } }),
      this.prisma.staff.findUnique({ where: { id: shift.staffId } }),
    ]);

    // Выручка от времени берётся по фактическим списаниям, а не по отрезкам,
    // начатым внутри смены: сессия, начатая до пересменки, продолжает приносить
    // деньги этой смене. Иначе ночной админ теряет всю выручку с машин,
    // занятых до его прихода.
    const charges = await this.prisma.transaction.findMany({
      where: {
        clubId: shift.clubId,
        type: TransactionType.SESSION_CHARGE,
        createdAt: window,
      },
      select: { amount: true, sessionId: true },
    });

    const sumBy = (method: PaymentMethod): number =>
      payments.filter((p) => p.method === method).reduce((sum, p) => sum + p.amount, 0);

    const salesBy = (method: PaymentMethod): number =>
      sales.filter((s) => s.method === method).reduce((sum, s) => sum + s.total, 0);

    // Списания хранятся отрицательными: расход по кошельку.
    const sessionsRevenue = charges.reduce((sum, t) => sum - t.amount, 0);
    const productsRevenue = sales.reduce((sum, s) => sum + s.total, 0);
    const productsCost = sales.reduce((sum, s) => sum + s.costAtSale * s.quantity, 0);

    const totals = computeShiftTotals({
      cash: {
        openingFloat: shift.openingFloat,
        // Платежи наличными — это и пополнения счетов, и продажа пакетов на стойке.
        topUpsCash: sumBy(PaymentMethod.CASH),
        packagesCash: 0,
        productsCash: salesBy(PaymentMethod.CASH),
      },
      cardTotal: sumBy(PaymentMethod.CARD) + salesBy(PaymentMethod.CARD),
      balanceTotal: salesBy(PaymentMethod.BALANCE) + sessionsRevenue,
      sessionsRevenue,
      productsRevenue,
    });

    return {
      shift,
      staffName: staffRecord?.fullName ?? "—",
      cashExpected: totals.cashExpected,
      cardTotal: totals.cardTotal,
      balanceTotal: totals.balanceTotal,
      revenue: totals.revenue,
      sessionsRevenue,
      productsRevenue,
      productsCost,
      topUpsTotal: payments
        .filter((p) => p.method !== PaymentMethod.BONUS)
        .reduce((sum, p) => sum + p.amount, 0),
      sessionsCount: new Set(charges.map((t) => t.sessionId).filter(Boolean)).size,
    };
  }

  private async requireShift(clubId: string, shiftId: string): Promise<Shift> {
    const shift = await this.prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift || shift.clubId !== clubId) throw new NotFoundException("Смена не найдена");
    return shift;
  }
}

export { TransactionType };
