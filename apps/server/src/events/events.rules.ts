/** Правила ивентов без базы: что можно делать с ивентом и сводка по приглашениям. */

export type InviteStatusName = "PENDING" | "SENT" | "FAILED" | "GOING" | "DECLINED";

export interface InviteSummary {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  going: number;
  declined: number;
}

export function summarizeInvites(statuses: Array<{ status: InviteStatusName; count: number }>): InviteSummary {
  const summary: InviteSummary = { total: 0, pending: 0, sent: 0, failed: 0, going: 0, declined: 0 };
  for (const { status, count } of statuses) {
    summary.total += count;
    summary[status.toLowerCase() as Exclude<keyof InviteSummary, "total">] += count;
  }
  return summary;
}

/** Что мешает разослать приглашения; null — можно. */
export function sendBlocker(
  event: { startsAt: Date; canceledAt: Date | null },
  now: Date,
): string | null {
  if (event.canceledAt) return "Ивент отменён";
  if (event.startsAt.getTime() <= now.getTime()) return "Ивент уже начался — приглашать поздно";
  return null;
}

/**
 * Пауза между сообщениями рассылки.
 *
 * WhatsApp блокирует номера, которые шлют пачками одинаковые сообщения
 * незнакомым. Гости клуба номер знают, но и для них сотня сообщений за
 * секунду выглядит как спам. Полторы секунды — сотня гостей за пару минут.
 */
export const SEND_PAUSE_MS = 1_500;

/** Сколько приглашений берёт один проход очереди. */
export const SEND_BATCH = 20;
