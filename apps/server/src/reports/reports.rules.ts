/**
 * Расчёты для отчётов по сети — чистые функции.
 *
 * Главное здесь — межклубный взаимозачёт: при общем кошельке деньги приходят
 * в один зал, а тратятся в другом, и разницу владелец должен видеть числом,
 * а не выяснять по жалобам управляющих (docs/billing.md, раздел 9.3).
 *
 * Все суммы — целые в тиын.
 */

export interface ClubMoneyFlow {
  clubId: string;
  clubName: string;
  /** Принято деньгами в этом зале: пополнения счетов. */
  collected: number;
  /** Потрачено с кошельков в этом зале: игра, бар, пакеты. */
  consumed: number;
}

export interface SettlementRow extends ClubMoneyFlow {
  /**
   * Принято минус потрачено.
   * Положительное — зал держит деньги, отыгранные в других залах, и должен им.
   * Отрицательное — зал заработал больше, чем принял, и сеть должна ему.
   */
  balance: number;
}

export interface Settlement {
  rows: SettlementRow[];
  /**
   * Сумма строк. Это не проверка сходимости, а изменение денег на кошельках
   * гостей за период: положительное — гости пополнили больше, чем отыграли,
   * и сеть должна им это время; отрицательное — тратили накопленное раньше.
   *
   * В ноль сходится только если за период гости потратили ровно столько,
   * сколько внесли, — в жизни так не бывает.
   */
  guestFundsChange: number;
}

export function computeSettlement(flows: ClubMoneyFlow[]): Settlement {
  const rows = flows
    .map((flow) => ({ ...flow, balance: flow.collected - flow.consumed }))
    .sort((a, b) => a.balance - b.balance);

  return { rows, guestFundsChange: rows.reduce((sum, r) => sum + r.balance, 0) };
}

export interface ComputerRevenue {
  computerId: string;
  computerName: string;
  zoneName: string;
  revenue: number;
  minutes: number;
  sessions: number;
}

/**
 * Прибыльность машины с учётом того, сколько она вообще могла заработать.
 *
 * Голая выручка обманывает: машина в VIP всегда «лучше» стандартной просто из-за
 * тарифа. Загрузка показывает, простаивает ли место, а выручка за час работы —
 * сколько оно приносит, когда занято.
 */
export interface ComputerPerformance extends ComputerRevenue {
  /** Доля занятого времени от периода, 0…1. */
  occupancy: number;
  /** Выручка за час занятости. */
  revenuePerBusyHour: number;
}

export function rankComputers(
  rows: ComputerRevenue[],
  periodMinutes: number,
): ComputerPerformance[] {
  return rows
    .map((row) => ({
      ...row,
      occupancy: periodMinutes > 0 ? Math.min(1, row.minutes / periodMinutes) : 0,
      revenuePerBusyHour: row.minutes > 0 ? Math.round((row.revenue * 60) / row.minutes) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface HourlyPoint {
  /** Час суток по времени клуба, 0…23. */
  hour: number;
  revenue: number;
  sessions: number;
}

/** Часы пик и мёртвые часы: ровно 24 точки, включая нулевые. */
export function fillHours(points: HourlyPoint[]): HourlyPoint[] {
  const byHour = new Map(points.map((p) => [p.hour, p]));
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? { hour, revenue: 0, sessions: 0 });
}
