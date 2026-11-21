import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CashMovementKind,
  PaymentMethod,
  type Shift,
  TransactionType,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  TelegramService,
  tgMoney,
  tgRole,
} from "../telegram/telegram.service.js";
import {
  type Reconciliation,
  computeShiftTotals,
  reconcile,
  tournamentNet,
} from "./shift.rules.js";

/** Движения турниров: считаются только вместе — см. tournamentNet. */
const TOURNAMENT_TYPES = [
  TransactionType.TOURNAMENT_ENTRY,
  TransactionType.TOURNAMENT_REFUND,
  TransactionType.TOURNAMENT_PRIZE,
];

/** Одно действие кассира за смену для журнала: пополнение счёта или продажа товара. */
export interface ShiftOperation {
  id: string;
  at: Date;
  kind: "topup" | "product";
  title: string;
  /** В тиын, всегда положительная: деньги, принятые кассиром. */
  amount: number;
  method: PaymentMethod;
}

export interface ShiftReport {
  shift: Shift;
  staffName: string;
  cashExpected: number;
  cardTotal: number;
  balanceTotal: number;
  revenue: number;
  /** Взносы за турниры минус возвраты и призы. Отрицательный — турнир стоил клубу. */
  tournamentNet: number;
  sessionsRevenue: number;
  productsRevenue: number;
  productsCost: number;
  topUpsTotal: number;
  sessionsCount: number;
  reconciliation: Reconciliation | null;
  // --- Модель Z-отчёта кассира ---
  /** Размен на начало смены. Наличные смены прибавляются к нему. */
  openingFloat: number;
  /** Клуб: все пополнения и пакеты за смену (любым способом). */
  clubTopUps: number;
  /** Бар: все продажи бара за смену. */
  barSales: number;
  /** Итог смены = Клуб + Бар. */
  grandTotal: number;
  /** Из Итога — наличными (пополнения + бар). */
  cashTotal: number;
  /** Из Итога — онлайн (пополнения + бар). Заработает с подключением Kaspi. */
  onlineTotal: number;
  /** Журнал действий кассира за смену: пополнения и пробитые товары, новые сверху. */
  operations: ShiftOperation[];

  // --- Движение наличных помимо продаж ---
  /** Внесено наличных в кассу за смену. */
  cashDeposits: number;
  /** Изъято из кассы (выемки/инкассации) за смену. */
  cashDrops: number;
  /** Израсходовано из кассы наличными за смену. */
  cashExpenses: number;
  /** Возвращено гостям наличными за смену. */
  cashRefunds: number;
  /** Возвращено гостям картой за смену (по чеку через пост-терминал). */
  cardRefunds: number;
  /** Наличные, принятые от продаж (пополнения + бар). */
  cashSales: number;
  /** Все движения наличных строками, новые сверху. */
  cashMovements: CashMovementRow[];

  // --- Сверка безнала (вводит сотрудник на закрытии) ---
  /** Карта по терминалу; null — не сверяли. */
  cardCounted: number | null;
  /** Онлайн по выписке Kaspi; null — не сверяли. */
  onlineCounted: number | null;

  // --- Итоги для владельца ---
  /** Число чеков за смену (пополнения + продажи бара). */
  checksCount: number;
  /** Средний чек: деньги в кассу / число чеков. */
  averageCheck: number;
  /** Топ товаров смены по выручке. */
  topProducts: TopProduct[];

  // --- Время смены ---
  openedAt: Date;
  closedAt: Date | null;
  /** Длительность смены в минутах (для открытой — на текущий момент). */
  durationMinutes: number;
}

/** Товар в топе смены. */
export interface TopProduct {
  name: string;
  quantity: number;
  revenue: number;
}

/** Одно движение наличных в кассе помимо продаж, для журнала смены. */
export interface CashMovementRow {
  id: string;
  at: Date;
  kind: CashMovementKind;
  method: PaymentMethod;
  amount: number;
  reason: string | null;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly telegram: TelegramService,
  ) {}

  /** Открытая смена клуба, если она есть. Кассовый экран показывает её в шапке. */
  async current(
    staff: AuthenticatedStaff,
    clubId: string,
  ): Promise<Shift | null> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.shift.findFirst({
      where: { clubId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
  }

  /**
   * Подсказка для пересменки: сколько наличных пересчитал прошлый кассир на
   * закрытии. Эта сумма физически осталась в ящике — её и предлагаем разменом
   * следующей смены, чтобы деньги передавались из рук в руки без пересчёта.
   */
  async handover(
    staff: AuthenticatedStaff,
    clubId: string,
  ): Promise<{
    suggestedFloat: number;
    fromStaff: string;
    closedAt: Date;
  } | null> {
    await this.access.requireClub(staff, clubId);
    const last = await this.prisma.shift.findFirst({
      where: { clubId, closedAt: { not: null }, cashCounted: { not: null } },
      orderBy: { closedAt: "desc" },
      include: { staff: { select: { fullName: true } } },
    });
    if (!last || last.cashCounted === null || last.closedAt === null) {
      return null;
    }
    return {
      suggestedFloat: last.cashCounted,
      fromStaff: last.staff.fullName,
      closedAt: last.closedAt,
    };
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

    const shift = await this.prisma.shift.create({
      data: { clubId, staffId: staff.id, openingFloat },
    });
    this.telegram.notify(
      clubId,
      `🟢 Смена открыта (${tgRole(staff.role)}). Размен: ${tgMoney(openingFloat)}`,
    );
    return shift;
  }

  /**
   * Закрытие смены. Расхождение не мешает закрыться и не правится автоматически:
   * недостача — факт, который фиксируют и разбирают, а не прячут.
   */
  async close(
    staff: AuthenticatedStaff,
    clubId: string,
    shiftId: string,
    input: {
      cashCounted: number;
      note?: string;
      cardCounted?: number;
      onlineCounted?: number;
    },
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
        cashCounted: input.cashCounted,
        cardCounted: input.cardCounted ?? null,
        onlineCounted: input.onlineCounted ?? null,
        note: input.note ?? null,
      },
    });

    // Пересчитываем отчёт по закрытой смене — так дата закрытия, длительность и
    // сверка безнала в ответе совпадают с сохранённым.
    const finalReport = await this.buildReport(closed);
    const diff = input.cashCounted - finalReport.cashExpected;
    this.telegram.notify(
      clubId,
      `🔴 Смена закрыта (${tgRole(staff.role)}). Деньги в кассу: ${tgMoney(finalReport.grandTotal)}. Наличные в ящике: ${tgMoney(input.cashCounted)}${diff !== 0 ? ` (расхождение ${diff > 0 ? "+" : "−"}${tgMoney(Math.abs(diff))})` : ""}`,
    );
    return {
      ...finalReport,
      reconciliation: reconcile(finalReport.cashExpected, input.cashCounted),
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
          ? reconcile(
              shift.cashExpected ?? report.cashExpected,
              shift.cashCounted,
            )
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

  private async buildReport(
    shift: Shift,
  ): Promise<Omit<ShiftReport, "reconciliation">> {
    const until = shift.closedAt ?? new Date();
    const window = { gte: shift.openedAt, lte: until };

    const [payments, sales, movements, staffRecord] = await Promise.all([
      // Деньги привязываем к смене по времени, а не по shiftId: если платёж
      // записался без смены или на чужую (касса пробила до открытия смены,
      // смену забыли открыть), по shiftId он терялся — и наличные «не считались».
      // Смены по времени не пересекаются, поэтому окно однозначно.
      this.prisma.payment.findMany({
        where: { clubId: shift.clubId, createdAt: window },
        include: { guest: { select: { fullName: true } } },
      }),
      this.prisma.productSale.findMany({
        where: { clubId: shift.clubId, createdAt: window },
        include: { product: { select: { name: true } } },
      }),
      this.prisma.cashMovement.findMany({
        where: { shiftId: shift.id },
        orderBy: { createdAt: "desc" },
      }),
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

    // Турнирные движения — тем же окном: взнос мог быть принят в эту смену,
    // а возврат за несобравшуюся команду уйти уже в следующую.
    const tournamentMoves = await this.prisma.transaction.findMany({
      where: {
        clubId: shift.clubId,
        type: { in: TOURNAMENT_TYPES },
        createdAt: window,
      },
      select: { amount: true },
    });

    const sumBy = (method: PaymentMethod): number =>
      payments
        .filter((p) => p.method === method)
        .reduce((sum, p) => sum + p.amount, 0);

    const salesBy = (method: PaymentMethod): number =>
      sales
        .filter((s) => s.method === method)
        .reduce((sum, s) => sum + s.total, 0);

    // Списания хранятся отрицательными: расход по кошельку.
    const sessionsRevenue = charges.reduce((sum, t) => sum - t.amount, 0);
    const tournaments = tournamentNet(tournamentMoves);
    const productsRevenue = sales.reduce((sum, s) => sum + s.total, 0);
    const productsCost = sales.reduce(
      (sum, s) => sum + s.costAtSale * s.quantity,
      0,
    );

    // Движение наличных помимо продаж: без него касса не сходится.
    const movedBy = (kind: CashMovementKind): number =>
      movements
        .filter((m) => m.kind === kind)
        .reduce((sum, m) => sum + m.amount, 0);
    const cashDeposits = movedBy(CashMovementKind.DEPOSIT);
    const cashDrops = movedBy(CashMovementKind.DROP);
    const cashExpenses = movedBy(CashMovementKind.EXPENSE);
    // Возврат наличными уменьшает наличные и ящик; возврат картой — безнал.
    const refundBy = (method: PaymentMethod): number =>
      movements
        .filter((m) => m.kind === CashMovementKind.REFUND && m.method === method)
        .reduce((sum, m) => sum + m.amount, 0);
    const cashRefunds = refundBy(PaymentMethod.CASH);
    const cardRefunds = refundBy(PaymentMethod.CARD);

    const totals = computeShiftTotals({
      cash: {
        openingFloat: shift.openingFloat,
        // Платежи наличными — это и пополнения счетов, и продажа пакетов на стойке.
        topUpsCash: sumBy(PaymentMethod.CASH),
        packagesCash: 0,
        productsCash: salesBy(PaymentMethod.CASH),
        deposits: cashDeposits,
        drops: cashDrops,
        expenses: cashExpenses,
        refunds: cashRefunds,
      },
      cardTotal:
        sumBy(PaymentMethod.CARD) +
        salesBy(PaymentMethod.CARD) -
        cardRefunds,
      balanceTotal: salesBy(PaymentMethod.BALANCE) + sessionsRevenue,
      sessionsRevenue,
      productsRevenue,
      tournamentNet: tournaments,
    });

    // Z-отчёт кассира: Клуб (пополнения и пакеты) + Бар = Итог, и тот же Итог
    // в разбивке по способу оплаты. Наличные + размен = ожидаемая касса.
    const clubTopUps = payments
      .filter((p) => p.method !== PaymentMethod.BONUS)
      .reduce((sum, p) => sum + p.amount, 0);
    const barSales = productsRevenue;
    // «Деньги в кассу за смену» — только то, что физически пришло этой сменой:
    // наличные + карта + онлайн. Оплата бара с баланса сюда не идёт (деньги
    // пришли прошлой сменой при пополнении). Возврат наличными уменьшает итог.
    const cashReceived =
      sumBy(PaymentMethod.CASH) + salesBy(PaymentMethod.CASH);
    const cashTotal = cashReceived - cashRefunds;
    const onlineTotal =
      sumBy(PaymentMethod.ONLINE) + salesBy(PaymentMethod.ONLINE);
    const grandTotal = cashTotal + totals.cardTotal + onlineTotal;

    // Журнал действий: каждое пополнение и каждый пробитый товар отдельной
    // строкой, новые сверху. Бонусные списания — не деньги кассы, их не берём.
    const operations: ShiftOperation[] = [
      ...payments
        .filter((p) => p.method !== PaymentMethod.BONUS)
        .map((p) => ({
          id: `p-${p.id}`,
          at: p.createdAt,
          kind: "topup" as const,
          title: p.guest?.fullName
            ? `Пополнение · ${p.guest.fullName}`
            : "Пополнение счёта",
          amount: p.amount,
          method: p.method,
        })),
      ...sales.map((s) => ({
        id: `s-${s.id}`,
        at: s.createdAt,
        kind: "product" as const,
        title: `${s.product.name} ×${s.quantity}`,
        amount: s.total,
        method: s.method,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    // Число чеков и средний чек: один платёж или одна продажа бара — один чек.
    const checksCount = payments.length + sales.length;
    const averageCheck =
      checksCount > 0 ? Math.round(grandTotal / checksCount) : 0;

    // Топ товаров смены по выручке.
    const byProduct = new Map<string, TopProduct>();
    for (const s of sales) {
      const row = byProduct.get(s.productId) ?? {
        name: s.product.name,
        quantity: 0,
        revenue: 0,
      };
      row.quantity += s.quantity;
      row.revenue += s.total;
      byProduct.set(s.productId, row);
    }
    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      shift,
      staffName: staffRecord?.fullName ?? "—",
      cashExpected: totals.cashExpected,
      cardTotal: totals.cardTotal,
      balanceTotal: totals.balanceTotal,
      revenue: totals.revenue,
      tournamentNet: tournaments,
      sessionsRevenue,
      productsRevenue,
      productsCost,
      topUpsTotal: clubTopUps,
      sessionsCount: new Set(charges.map((t) => t.sessionId).filter(Boolean))
        .size,
      // Поля модели кассира.
      openingFloat: shift.openingFloat,
      clubTopUps,
      barSales,
      grandTotal,
      cashTotal,
      onlineTotal,
      operations,
      // Движение наличных помимо продаж.
      cashDeposits,
      cashDrops,
      cashExpenses,
      cashRefunds,
      cardRefunds,
      cashSales: cashReceived,
      cashMovements: movements.map((m) => ({
        id: m.id,
        at: m.createdAt,
        kind: m.kind,
        method: m.method,
        amount: m.amount,
        reason: m.reason,
      })),
      // Сверка безнала.
      cardCounted: shift.cardCounted,
      onlineCounted: shift.onlineCounted,
      // Итоги для владельца.
      checksCount,
      averageCheck,
      topProducts,
      // Время смены: открыта, закрыта и длительность в минутах.
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      durationMinutes: Math.max(
        0,
        Math.round((until.getTime() - shift.openedAt.getTime()) / 60000),
      ),
    };
  }

  /**
   * Движение наличных в кассе помимо продаж. Привязывается к открытой смене:
   * вносить и изымать деньги можно только пока касса открыта.
   */
  async addCashMovement(
    staff: AuthenticatedStaff,
    clubId: string,
    shiftId: string,
    dto: {
      kind: CashMovementKind;
      amount: number;
      reason?: string;
      method?: PaymentMethod;
    },
  ) {
    await this.access.requireClub(staff, clubId);
    const shift = await this.requireShift(clubId, shiftId);
    if (shift.closedAt) {
      throw new BadRequestException("Смена закрыта — касса уже сверена");
    }
    // Способ важен только для возврата (нал/карта). Внесения, выемки и расходы
    // всегда наличные — для них способ принудительно CASH.
    const method =
      dto.kind === CashMovementKind.REFUND && dto.method === PaymentMethod.CARD
        ? PaymentMethod.CARD
        : PaymentMethod.CASH;
    const movement = await this.prisma.cashMovement.create({
      data: {
        clubId,
        shiftId: shift.id,
        staffId: staff.id,
        kind: dto.kind,
        method,
        amount: dto.amount,
        reason: dto.reason?.trim() || null,
      },
    });
    const kindLabel: Record<CashMovementKind, string> = {
      DEPOSIT: "Приходный ордер (внесение)",
      DROP: "Выемка",
      EXPENSE: "Расходный ордер",
      REFUND: method === PaymentMethod.CARD ? "Возврат картой" : "Возврат наличными",
    };
    this.telegram.notify(
      clubId,
      `🧾 ${kindLabel[dto.kind]}: ${tgMoney(dto.amount)} (${tgRole(staff.role)})${dto.reason ? ` — ${dto.reason.trim()}` : ""}`,
    );
    return movement;
  }

  private async requireShift(clubId: string, shiftId: string): Promise<Shift> {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
    });
    if (!shift || shift.clubId !== clubId)
      throw new NotFoundException("Смена не найдена");
    return shift;
  }
}

export { TransactionType };
