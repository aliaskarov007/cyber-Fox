/**
 * Подписи афиши. Время показывается по часам этого ПК — он стоит в том же
 * городе, что и клуб.
 */
const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** «Суббота, 11 октября, с 18:00» — или «Идёт сейчас», если уже началось. */
export function eventWhen(startsAt: Date, now: Date): string {
  if (startsAt <= now) return "Идёт сейчас";
  const hh = String(startsAt.getHours()).padStart(2, "0");
  const mm = String(startsAt.getMinutes()).padStart(2, "0");
  return `${WEEKDAYS[startsAt.getDay()]}, ${startsAt.getDate()} ${MONTHS[startsAt.getMonth()]}, с ${hh}:${mm}`;
}

/** Крупная дата на афише: «11.10». */
export function eventDay(startsAt: Date): string {
  const dd = String(startsAt.getDate()).padStart(2, "0");
  const mo = String(startsAt.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mo}`;
}

/** Название сети с оранжевым дефисом, если он в названии есть: «Cyber-Fox». */
export function splitBrand(name: string): [string, string | null, string] {
  const i = name.indexOf("-");
  if (i <= 0 || i === name.length - 1) return [name, null, ""];
  return [name.slice(0, i), "-", name.slice(i + 1)];
}
