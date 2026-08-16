import type { LocalMoment } from "../billing/billing.rules.js";

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Приводит момент к часовому поясу клуба.
 *
 * Правила тарификации ничего не знают о поясах: им передаётся минута суток и день
 * недели, уже посчитанные здесь. Ночной тариф «с 22:00» должен наступать в 22:00
 * по местному времени зала, а не по времени сервера.
 */
export function toLocalMoment(at: Date, timezone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);

  const lookup = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  // В полночь Intl отдаёт «24» вместо «00» — приводим к нулю.
  const hour = Number(lookup("hour")) % 24;
  const minute = Number(lookup("minute"));

  return {
    minuteOfDay: hour * 60 + minute,
    dayOfWeek: WEEKDAY_TO_ISO[lookup("weekday")] ?? 1,
    at,
  };
}
