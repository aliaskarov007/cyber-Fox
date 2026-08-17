import type { Tariff } from "./api.js";

/**
 * Окно действия тарифа по времени суток. В базе оно лежит минутами от полуночи,
 * а администратор набирает «22:00» — перевод нужен обеим сторонам и экрану, и
 * форме, поэтому живёт отдельно от них.
 */

/** Минуты от полуночи → «22:00». */
export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** «22:00» → минуты от полуночи. undefined — строка пустая или набрана неверно. */
export function toMinuteOfDay(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1439 ? minutes : undefined;
}

export function formatWindow(tariff: Tariff): string {
  if (tariff.activeFromMinute === null || tariff.activeToMinute === null) return "круглосуточно";
  return `${hhmm(tariff.activeFromMinute)}–${hhmm(tariff.activeToMinute)}`;
}
