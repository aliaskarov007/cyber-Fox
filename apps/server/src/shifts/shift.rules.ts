/**
 * Правила сверки кассы — чистые функции.
 *
 * Считаются деньги, за которые сотрудник отчитывается лично, поэтому логика
 * вынесена из сервиса и проверяется тестами на конкретных числах.
 * Все суммы — целые в тиын (1/100 ₸).
 */

export interface CashFlow {
  /** Размен, оставленный в кассе на начало смены. */
  openingFloat: number;
  /** Пополнения счетов гостей наличными. */
  topUpsCash: number;
  /** Продажа пакетов за наличные. */
  packagesCash: number;
  /** Продажа товаров за наличные. */
  productsCash: number;
}

export interface ShiftTotals {
  /** Сколько наличных должно лежать в кассе на момент закрытия. */
  cashExpected: number;
  /** Безнал за смену — в кассе его нет, но в выручке он есть. */
  cardTotal: number;
  /** Списано с балансов гостей: деньги пришли в кассу раньше, в другую смену. */
  balanceTotal: number;
  /** Выручка смены целиком, независимо от способа оплаты. */
  revenue: number;
}

/**
 * Ожидаемая наличность и выручка смены.
 *
 * Ключевое различие: наличные в ящике и выручка смены — разные числа. Гость мог
 * пополнить счёт вчера, а отыграть сегодня: деньги в кассе прошлой смены,
 * а время продано этой. Смешивать их — верный способ поссорить сотрудников.
 */
export function computeShiftTotals(params: {
  cash: CashFlow;
  cardTotal: number;
  balanceTotal: number;
  /** Начислено по сессиям за смену, из отрезков. */
  sessionsRevenue: number;
  /** Продано товаров за смену, любым способом. */
  productsRevenue: number;
}): ShiftTotals {
  const { cash } = params;
  const cashExpected =
    cash.openingFloat + cash.topUpsCash + cash.packagesCash + cash.productsCash;

  return {
    cashExpected,
    cardTotal: params.cardTotal,
    balanceTotal: params.balanceTotal,
    revenue: params.sessionsRevenue + params.productsRevenue,
  };
}

export const Discrepancy = {
  MATCH: "MATCH",
  SHORTAGE: "SHORTAGE",
  SURPLUS: "SURPLUS",
} as const;
export type Discrepancy = (typeof Discrepancy)[keyof typeof Discrepancy];

export interface Reconciliation {
  expected: number;
  counted: number;
  /** Пересчитано минус ожидаемое: отрицательное — недостача. */
  difference: number;
  status: Discrepancy;
}

/**
 * Сверка кассы на закрытии.
 *
 * Расхождение не исправляется автоматически и не мешает закрыть смену:
 * недостача — факт, который надо зафиксировать и разобрать, а не спрятать.
 */
export function reconcile(expected: number, counted: number): Reconciliation {
  const difference = counted - expected;
  return {
    expected,
    counted,
    difference,
    status:
      difference === 0
        ? Discrepancy.MATCH
        : difference < 0
          ? Discrepancy.SHORTAGE
          : Discrepancy.SURPLUS,
  };
}

/**
 * Бонусы за потраченное. Начисляются от суммы, реально ушедшей из кошелька,
 * а не от прейскуранта: скидка не должна превращаться в бонусы.
 */
export function bonusFor(spent: number, percent: number): number {
  if (percent <= 0 || spent <= 0) return 0;
  return Math.floor((spent * percent) / 100);
}
