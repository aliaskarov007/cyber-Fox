/**
 * Отток гостей зала — правила без базы.
 *
 * «Ушёл» — это постоянный гость, который давно не приходил. Случайный гость,
 * заглянувший один раз, не уходит: он и не приходил. Поэтому в отчёт попадают
 * только те, у кого набралось хотя бы несколько визитов.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionStatus = "active" | "at_risk" | "lost";

export interface GuestVisitStats {
  guestId: string;
  visits: number;
  /** Деньги за игру и бар в этом зале, тиын. */
  spent: number;
  firstAt: Date;
  lastAt: Date;
  /** Обычный промежуток между визитами, дней; null — визит один. */
  medianGapDays: number | null;
  /** Час начала, к которому гость тяготеет, по времени зала. */
  usualHour: number | null;
}

export interface RetentionOptions {
  /** Сколько дней без визита — и постоянный гость считается ушедшим. */
  lostAfterDays: number;
  /** Со скольких визитов гость считается постоянным. */
  minVisits: number;
}

export const DEFAULT_OPTIONS: RetentionOptions = { lostAfterDays: 30, minVisits: 3 };

/**
 * Где гость сейчас.
 *
 * «Под угрозой» — пропал заметно дольше своего обычного ритма, но ещё не
 * насовсем: ходил раз в три дня, а не был две недели. Таких вернуть проще
 * всего, и написать им стоит раньше, чем они превратятся в ушедших.
 */
export function classify(
  stats: Pick<GuestVisitStats, "lastAt" | "medianGapDays">,
  now: Date,
  options: RetentionOptions,
): { status: RetentionStatus; daysSince: number } {
  const daysSince = Math.floor((now.getTime() - stats.lastAt.getTime()) / DAY_MS);
  if (daysSince >= options.lostAfterDays) return { status: "lost", daysSince };

  // Ритм меньше суток (два ПК за вечер) ритмом не считается.
  const rhythm = Math.max(1, stats.medianGapDays ?? options.lostAfterDays);
  const riskAfter = Math.max(7, Math.ceil(rhythm * 2.5));
  if (daysSince >= riskAfter) return { status: "at_risk", daysSince };

  return { status: "active", daysSince };
}

export function isRegular(stats: Pick<GuestVisitStats, "visits">, options: RetentionOptions): boolean {
  return stats.visits >= options.minVisits;
}

/** Время суток словами — так в отчёте понятнее, чем «чаще всего в 19 часов». */
export function partOfDay(hour: number | null): string | null {
  if (hour === null) return null;
  if (hour >= 6 && hour < 12) return "утро";
  if (hour >= 12 && hour < 18) return "день";
  if (hour >= 18) return "вечер";
  return "ночь";
}

/** «2026-07» — месяц последнего визита в поясе зала. */
export function monthKey(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

/** Последние `count` месяцев, от старого к новому, включая текущий. */
export function lastMonths(now: Date, timezone: string, count: number): string[] {
  const [year, month] = monthKey(now, timezone).split("-").map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const total = year * 12 + (month - 1) - i;
    keys.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Сколько постоянных гостей ушло по месяцам — по месяцу последнего визита.
 * Видно, когда утечка началась: месяц, после которого гости больше не пришли.
 */
export function churnByMonth(
  lost: Array<{ lastAt: Date; spent: number; visits: number; firstAt: Date }>,
  months: string[],
  timezone: string,
): Array<{ month: string; guests: number; monthlySpend: number }> {
  const byMonth = new Map(months.map((m) => [m, { guests: 0, monthlySpend: 0 }]));
  for (const guest of lost) {
    const bucket = byMonth.get(monthKey(guest.lastAt, timezone));
    if (!bucket) continue;
    bucket.guests += 1;
    bucket.monthlySpend += monthlySpend(guest);
  }
  return months.map((month) => ({ month, ...byMonth.get(month)! }));
}

/**
 * Сколько гость приносил в месяц, пока ходил. Им измеряется цена ухода:
 * гость, тративший 30 000 ₸ в месяц, важнее того, кто за полгода оставил 5 000.
 */
export function monthlySpend(guest: { spent: number; firstAt: Date; lastAt: Date }): number {
  const months = Math.max(1, (guest.lastAt.getTime() - guest.firstAt.getTime()) / (30 * DAY_MS));
  return Math.round(guest.spent / months);
}

/** Подставки в тексте сообщения. {код} обязателен — без него письмо бесполезно. */
export const MESSAGE_PLACEHOLDERS = ["{имя}", "{клуб}", "{подарок}", "{код}", "{до}"] as const;

export const DEFAULT_MESSAGE =
  "{имя}, давно вас не видели в «{клуб}»! Дарим {подарок} по промокоду {код} — " +
  "введите его за компьютером после входа. Код действует до {до}.";

export const OPT_OUT_LINE = "Чтобы не получать сообщения, ответьте СТОП.";

/** Что мешает тексту уйти; null — можно. */
export function messageBlocker(template: string): string | null {
  const text = template.trim();
  if (text.length < 20) return "Текст слишком короткий";
  if (text.length > 700) return "Текст длиннее 700 знаков — гость его не дочитает";
  if (!text.includes("{код}")) return "В тексте нет {код} — гость не узнает свой промокод";
  return null;
}

/**
 * Готовое сообщение гостю. Строка про «СТОП» добавляется всегда: без неё
 * рассылка выглядит как спам, а WhatsApp блокирует за спам номер клуба.
 */
export function renderMessage(
  template: string,
  values: { name: string; club: string; gift: string; code: string; until: string },
): string {
  const firstName = values.name.trim().split(/\s+/)[0] || "Здравствуйте";
  const body = template
    .trim()
    .replaceAll("{имя}", firstName)
    .replaceAll("{клуб}", values.club)
    .replaceAll("{подарок}", values.gift)
    .replaceAll("{код}", values.code)
    .replaceAll("{до}", values.until);
  return `${body}\n\n${OPT_OUT_LINE}`;
}

/** Не писать одному гостю чаще раза в месяц: настойчивость выглядит как спам. */
export const WINBACK_COOLDOWN_DAYS = 30;

export function recentlyContacted(lastSentAt: Date | null, now: Date): boolean {
  if (!lastSentAt) return false;
  return now.getTime() - lastSentAt.getTime() < WINBACK_COOLDOWN_DAYS * DAY_MS;
}
