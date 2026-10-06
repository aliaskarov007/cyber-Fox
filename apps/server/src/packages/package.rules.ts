/**
 * Правила пакетов: «N+M» с бонусными часами, ночной пакет и абонемент с
 * переносом остатка (docs/billing.md, раздел 4.6).
 *
 * Здесь только арифметика — без базы и без часовых поясов: минута суток и
 * текущий момент приходят уже посчитанными.
 */

/** Окно времени суток в минутах от полуночи. Может переходить через полночь. */
export interface DayWindow {
  from: number;
  to: number;
}

/** Идёт ли сейчас окно. Конец не включается: в 08:00 ночь уже кончилась. */
export function insideWindow(minuteOfDay: number, window: DayWindow): boolean {
  if (window.from === window.to) return true;
  return window.from < window.to
    ? minuteOfDay >= window.from && minuteOfDay < window.to
    : minuteOfDay >= window.from || minuteOfDay < window.to;
}

/** Сколько минут осталось до конца окна. Вне окна — 0. */
export function minutesUntilWindowEnd(minuteOfDay: number, window: DayWindow): number {
  if (!insideWindow(minuteOfDay, window)) return 0;
  return (window.to - minuteOfDay + 1440) % 1440 || 1440;
}

/** Минут в пакете «N+M»: оплаченные плюс подарок. */
export function packageTotalMinutes(paidMinutes: number, bonusMinutes: number): number {
  return paidMinutes + Math.max(0, bonusMinutes);
}

/** «2+1», «3+2» — так пакет называют на стойке. Дробные часы — минутами. */
export function bonusLabel(paidMinutes: number, bonusMinutes: number): string | null {
  if (bonusMinutes <= 0) return null;
  const part = (m: number): string => (m % 60 === 0 ? String(m / 60) : `${m} мин`);
  return `${part(paidMinutes)}+${part(bonusMinutes)}`;
}

export interface RolloverSettings {
  /** Сколько процентов остатка переносится при продлении. */
  percent: number;
  /** То же для третьего абонемента подряд и дальше. */
  streakPercent: number;
  /** Потолок перенесённого — процент от оплаченных минут нового абонемента. */
  capPercent: number;
  /** За сколько дней до окончания продление уже считается продлением. */
  renewBeforeDays: number;
  /** Сколько дней после окончания продлить ещё не поздно. */
  renewAfterDays: number;
}

/** Абонемент, с которого переносится остаток. */
export interface OldSubscription {
  minutesTotal: number;
  minutesRemaining: number;
  /** Сколько в нём самом было перенесено с прошлого: второй раз не переносится. */
  carriedMinutes: number;
  pricePaid: number;
  expiresAt: Date;
}

/** Абонемент, в который переносится. */
export interface NewSubscription {
  /** Оплаченные минуты, без перенесённых. */
  paidMinutes: number;
  pricePaid: number;
  /** Какой по счёту абонемент подряд: 2 — первое продление. */
  streak: number;
}

/** Можно ли считать покупку продлением старого абонемента. */
export function isRenewal(old: { expiresAt: Date }, now: Date, settings: RolloverSettings): boolean {
  const day = 86_400_000;
  const opens = old.expiresAt.getTime() - settings.renewBeforeDays * day;
  const closes = old.expiresAt.getTime() + settings.renewAfterDays * day;
  return now.getTime() >= opens && now.getTime() <= closes;
}

/** Процент переноса: с третьего абонемента подряд — повышенный. */
export function rolloverPercent(streak: number, settings: RolloverSettings): number {
  return streak >= 3 ? settings.streakPercent : settings.percent;
}

/**
 * Сколько минут переедет в новый абонемент.
 *
 * - Переносится только своё, оплаченное: перенесённое в старый абонемент
 *   тратится первым и второй раз не едет.
 * - Минуты пересчитываются по цене: час VIP дороже часа Стандарта, и перенос из
 *   дешёвой зоны в дорогую даёт меньше минут, а не столько же.
 * - Не больше потолка от оплаченных минут нового абонемента.
 */
export function rolloverMinutes(old: OldSubscription, next: NewSubscription, settings: RolloverSettings): number {
  const ownPaid = Math.max(0, old.minutesTotal - old.carriedMinutes);
  const carryable = Math.min(old.minutesRemaining, ownPaid);
  if (carryable <= 0 || ownPaid === 0 || next.paidMinutes <= 0) return 0;

  const percent = rolloverPercent(next.streak, settings);
  const share = (carryable * percent) / 100;

  const oldMinutePrice = old.pricePaid / ownPaid;
  const newMinutePrice = next.pricePaid / next.paidMinutes;
  // Бесплатный абонемент (подарок) переносит минуты как есть.
  const converted = newMinutePrice > 0 && oldMinutePrice > 0 ? (share * oldMinutePrice) / newMinutePrice : share;

  const cap = (next.paidMinutes * settings.capPercent) / 100;
  return Math.max(0, Math.floor(Math.min(converted, cap)));
}

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** «6 ч 30 мин», «45 мин». */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/**
 * Напоминание на экране ПК: абонемент скоро кончится, продлите — часть
 * остатка переедет. Без напоминания перенос работает вполсилы: гость о нём
 * просто не помнит.
 *
 * `day` и `month` — дата окончания по часам клуба, уже посчитанная снаружи.
 */
export function renewalHint(
  pkg: { minutesTotal: number; minutesRemaining: number; carriedMinutes: number; pricePaid: number; expiresAt: Date; streak: number },
  tariff: { packageMinutes: number | null; packagePrice: number | null },
  settings: RolloverSettings,
  now: Date,
  ends: { day: number; month: number },
): string | null {
  if (pkg.minutesRemaining <= 0 || !isRenewal(pkg, now, settings) || pkg.expiresAt <= now) return null;
  if (!tariff.packageMinutes || tariff.packagePrice === null) return null;

  const carry = rolloverMinutes(
    pkg,
    { paidMinutes: tariff.packageMinutes, pricePaid: tariff.packagePrice, streak: pkg.streak + 1 },
    settings,
  );
  if (carry <= 0) return null;

  const date = `${ends.day} ${MONTHS[ends.month - 1]}`;
  return (
    `Абонемент заканчивается ${date}, осталось ${formatMinutes(pkg.minutesRemaining)}. ` +
    `Продлите у администратора — перенесём ${formatMinutes(carry)} в новый.`
  );
}
