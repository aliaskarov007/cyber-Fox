/**
 * Правила тарификации в чистом виде — без базы, времени и сети.
 *
 * Здесь считаются деньги, поэтому логика вынесена из сервиса: каждое решение
 * проверяется тестом на конкретных числах, а не через поднятую базу.
 * Спецификация — docs/billing.md.
 *
 * Все суммы — целые числа в тиын (1/100 ₸).
 */

export type Money = number;

export const SegmentEndReason = {
  PACKAGE_EXHAUSTED: "PACKAGE_EXHAUSTED",
  CREDIT_LIMIT: "CREDIT_LIMIT",
  ZONE_CHANGE: "ZONE_CHANGE",
  TARIFF_SCHEDULE: "TARIFF_SCHEDULE",
  STOPPED_BY_STAFF: "STOPPED_BY_STAFF",
  STOPPED_BY_GUEST: "STOPPED_BY_GUEST",
  PAUSED: "PAUSED",
} as const;
export type SegmentEndReason = (typeof SegmentEndReason)[keyof typeof SegmentEndReason];

export interface PackageState {
  id: string;
  zoneId: string;
  minutesRemaining: number;
  expiresAt: Date;
}

export interface PerMinuteTariffState {
  id: string;
  pricePerMinute: Money;
  /** Окно действия по времени суток, минуты от полуночи. Пусто — круглосуточно. */
  activeFromMinute: number | null;
  activeToMinute: number | null;
  /** Дни недели, 1 = понедельник. Пусто — все дни. */
  daysOfWeek: number[];
}

/**
 * Кошелёк гостя. Для анонимной посадки кошелька нет: ни баланса, ни кредита,
 * играть можно только по уже оплаченному времени.
 */
export interface WalletState {
  balance: Money;
  creditLimit: Money;
}

export interface CurrentSegmentState {
  kind: "PACKAGE" | "PER_MINUTE";
  tariffId: string;
  guestPackageId: string | null;
}

export interface SessionBillingState {
  zoneId: string;
  currentSegment: CurrentSegmentState;
  /** Активные пакеты гостя в клубе и зоне сессии. */
  packages: PackageState[];
  /** null — анонимная посадка. */
  wallet: WalletState | null;
  /** Поминутные тарифы зоны, из которых выбирается действующий сейчас. */
  perMinuteTariffs: PerMinuteTariffState[];
}

/** Момент времени, уже приведённый к часовому поясу клуба. */
export interface LocalMoment {
  /** Минуты от полуночи, 0…1439. */
  minuteOfDay: number;
  /** День недели, 1 = понедельник. */
  dayOfWeek: number;
  /** Абсолютный момент — для проверки сроков сгорания. */
  at: Date;
}

export type BillingDecision =
  /** Тратим минуту пакета: денег не списываем. */
  | { kind: "PACKAGE_MINUTE"; packageId: string }
  /** Списываем минуту с кошелька — возможно, в долг. */
  | { kind: "PAID_MINUTE"; tariffId: string; amount: Money }
  /** Текущий пакет исчерпан, но в зоне есть следующий — продолжаем на нём. */
  | { kind: "SWITCH_PACKAGE"; packageId: string; closeReason: SegmentEndReason }
  /** Минут в зоне не осталось либо сменился тариф по расписанию. */
  | { kind: "SWITCH_PER_MINUTE"; tariffId: string; closeReason: SegmentEndReason }
  /** Играть дальше не на что. */
  | { kind: "STOP"; reason: SegmentEndReason };

/**
 * Действует ли тариф в этот момент. Окно может пересекать полночь:
 * ночной тариф 22:00–08:00 действует и в 23:00, и в 03:00.
 */
export function isTariffActiveAt(tariff: PerMinuteTariffState, moment: LocalMoment): boolean {
  if (tariff.daysOfWeek.length > 0 && !tariff.daysOfWeek.includes(moment.dayOfWeek)) {
    return false;
  }
  const { activeFromMinute: from, activeToMinute: to } = tariff;
  if (from === null || to === null) return true;
  if (from === to) return true;
  return from < to
    ? moment.minuteOfDay >= from && moment.minuteOfDay < to
    : moment.minuteOfDay >= from || moment.minuteOfDay < to;
}

/**
 * Поминутный тариф, действующий сейчас. Тариф с ограниченным окном выигрывает у
 * круглосуточного: ночная цена для того и заводится, чтобы перебивать дневную.
 */
export function pickPerMinuteTariff(
  tariffs: PerMinuteTariffState[],
  moment: LocalMoment,
): PerMinuteTariffState | null {
  const active = tariffs.filter((t) => isTariffActiveAt(t, moment));
  if (active.length === 0) return null;
  const scheduled = active.filter((t) => t.activeFromMinute !== null && t.activeToMinute !== null);
  return (scheduled.length > 0 ? scheduled : active)[0];
}

/**
 * Пакет, которым играем следующим: своя зона, есть минуты, не сгорел.
 * Первым тратится тот, что и так сгорит раньше остальных.
 */
export function pickNextPackage(
  packages: PackageState[],
  zoneId: string,
  moment: LocalMoment,
): PackageState | null {
  const usable = packages
    .filter((p) => p.zoneId === zoneId && p.minutesRemaining > 0 && p.expiresAt > moment.at)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  return usable[0] ?? null;
}

/** Хватает ли на очередную минуту с учётом кредита. */
export function canAffordMinute(wallet: WalletState | null, price: Money): boolean {
  if (wallet === null) return false;
  return wallet.balance - price >= -wallet.creditLimit;
}

/**
 * На сколько минут хватит кошелька вместе с кредитом. Это то число,
 * которое видит гость на экране, поэтому считается тут, а не в интерфейсе.
 */
export function minutesAffordable(wallet: WalletState | null, price: Money): number {
  if (wallet === null || price <= 0) return 0;
  return Math.max(0, Math.floor((wallet.balance + wallet.creditLimit) / price));
}

/** Остаток кредита: сколько ещё можно уйти в минус. Ноль, пока баланс положительный. */
export function creditLeft(wallet: WalletState | null): Money {
  if (wallet === null) return 0;
  if (wallet.balance >= 0) return wallet.creditLimit;
  return Math.max(0, wallet.creditLimit + wallet.balance);
}

/**
 * Что делать с очередной минутой сессии.
 *
 * Вызывающий применяет решение и, если это переключение, спрашивает снова —
 * так исчерпание пакета не прерывает игру, а лишь закрывает отрезок.
 */
export function decideNextMinute(
  state: SessionBillingState,
  moment: LocalMoment,
): BillingDecision {
  const segment = state.currentSegment;

  if (segment.kind === "PACKAGE") {
    const current = state.packages.find((p) => p.id === segment.guestPackageId);
    // Пакет, действительный на момент старта, доигрывается до конца сессии:
    // срок проверяется при старте, а не посреди игры (docs/billing.md, 4.2).
    if (current && current.minutesRemaining > 0) {
      return { kind: "PACKAGE_MINUTE", packageId: current.id };
    }
    const next = pickNextPackage(
      state.packages.filter((p) => p.id !== segment.guestPackageId),
      state.zoneId,
      moment,
    );
    if (next) {
      return {
        kind: "SWITCH_PACKAGE",
        packageId: next.id,
        closeReason: SegmentEndReason.PACKAGE_EXHAUSTED,
      };
    }
    const fallback = pickPerMinuteTariff(state.perMinuteTariffs, moment);
    if (!fallback) return { kind: "STOP", reason: SegmentEndReason.PACKAGE_EXHAUSTED };
    return {
      kind: "SWITCH_PER_MINUTE",
      tariffId: fallback.id,
      closeReason: SegmentEndReason.PACKAGE_EXHAUSTED,
    };
  }

  const scheduled = pickPerMinuteTariff(state.perMinuteTariffs, moment);
  if (!scheduled) return { kind: "STOP", reason: SegmentEndReason.CREDIT_LIMIT };

  // Сменилось окно тарифа — например, наступил ночной час.
  if (scheduled.id !== segment.tariffId) {
    return {
      kind: "SWITCH_PER_MINUTE",
      tariffId: scheduled.id,
      closeReason: SegmentEndReason.TARIFF_SCHEDULE,
    };
  }

  if (!canAffordMinute(state.wallet, scheduled.pricePerMinute)) {
    return { kind: "STOP", reason: SegmentEndReason.CREDIT_LIMIT };
  }

  return {
    kind: "PAID_MINUTE",
    tariffId: scheduled.id,
    amount: scheduled.pricePerMinute,
  };
}

/**
 * Сколько минут досчитать после простоя сервера.
 *
 * Ограничение важнее точности: если процесс лежал час, гость не должен выйти
 * в минус на тысячу тенге из-за нашей аварии. Больше кредита не досчитываем.
 */
export function catchUpMinutes(
  elapsedMinutes: number,
  wallet: WalletState | null,
  price: Money,
): number {
  if (elapsedMinutes <= 0) return 0;
  if (price <= 0) return elapsedMinutes;
  return Math.min(elapsedMinutes, minutesAffordable(wallet, price));
}
