/**
 * Правила WhatsApp-канала без обращений к сети и базе: формат Green-API,
 * ответы гостей на приглашения, тексты сообщений.
 */

import { normalizePhone } from "../common/phone.js";

/** Идентификатор чата Green-API для личного номера. */
export function toChatId(phone: string): string | null {
  const normalized = normalizePhone(phone);
  return normalized ? `${normalized.slice(1)}@c.us` : null;
}

/** Номер отправителя из идентификатора чата; группы (`@g.us`) не принимаем. */
export function phoneFromChatId(chatId: string): string | null {
  const match = /^(\d{10,15})@c\.us$/.exec(chatId);
  return match ? match[1] : null;
}

/** Входящее сообщение, вытащенное из уведомления Green-API. */
export interface GreenApiIncoming {
  instanceId: string;
  /** Цифры с кодом страны, как их отдаёт WhatsApp. */
  from: string;
  text: string;
}

/**
 * Разбирает уведомление Green-API.
 *
 * Интересуют только входящие текстовые сообщения из личных чатов; статусы
 * доставки, звонки и группы молча пропускаются — на них уведомление тоже приходит.
 */
export function readIncoming(payload: unknown): GreenApiIncoming | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    typeWebhook?: string;
    instanceData?: { idInstance?: number | string };
    senderData?: { chatId?: string };
    messageData?: {
      textMessageData?: { textMessage?: string };
      extendedTextMessageData?: { text?: string };
    };
  };

  if (body.typeWebhook !== "incomingMessageReceived") return null;

  const instanceId = body.instanceData?.idInstance;
  const from = phoneFromChatId(body.senderData?.chatId ?? "");
  const text =
    body.messageData?.textMessageData?.textMessage ?? body.messageData?.extendedTextMessageData?.text;

  if (instanceId === undefined || !from || typeof text !== "string") return null;
  return { instanceId: String(instanceId), from, text };
}

export type InviteReply = "going" | "declined";

/**
 * Ответ на приглашение. Гости отвечают коротко и как попало: «1», «да!»,
 * «Иду». Распознаём только однозначное — остальное обычная переписка, её
 * читает человек на телефоне клуба.
 */
export function parseInviteReply(text: string): InviteReply | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.!,)(\s]+$/u, "")
    .replace(/^[\s.!,]+/u, "");

  if (cleaned.length === 0 || cleaned.length > 20) return null;
  if (["1", "да", "иду", "буду", "приду", "+", "ок", "ok", "👍"].includes(cleaned)) return "going";
  if (["2", "нет", "не иду", "не буду", "не приду", "-", "👎"].includes(cleaned)) return "declined";
  return null;
}

export function replyAck(reply: InviteReply, eventTitle: string): string {
  return reply === "going"
    ? `Записали вас на «${eventTitle}». Ждём!`
    : `Поняли, на «${eventTitle}» не ждём. Увидимся в другой раз!`;
}

export const VERIFIED_ACK = "Номер подтверждён ✅ Вернитесь к компьютеру — экран уже продолжил регистрацию.";
export const STOP_ACK = "Вы отписались от приглашений. Снова подписаться можно у администратора клуба.";

/** Дата и время ивента по часам зала, а не сервера. */
export function formatEventTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Приглашение из карточки афиши. Пустые строки афиши в текст не попадают. */
export function inviteMessage(event: {
  title: string;
  subtitle: string | null;
  startsAt: Date;
  place: string;
  prize: string | null;
  fee: string | null;
  howToJoin: string | null;
  timezone: string;
  guestName: string;
}): string {
  // Гость без имени заведён как «Гость 4567» — обращаться так к человеку странно.
  const firstName = /^Гость \d+$/.test(event.guestName) ? "" : (event.guestName.trim().split(/\s+/)[0] ?? "");

  return [
    firstName ? `${firstName}, приглашаем на ивент!` : "Приглашаем на ивент!",
    "",
    `🎮 ${event.title}`,
    ...(event.subtitle ? [event.subtitle] : []),
    `📍 ${event.place}`,
    `🕒 ${formatEventTime(event.startsAt, event.timezone)}`,
    ...(event.prize ? [`🏆 ${event.prize}`] : []),
    ...(event.fee ? [`💳 ${event.fee}`] : []),
    ...(event.howToJoin ? ["", event.howToJoin] : []),
    "",
    "Ответьте 1 — приду, 2 — не смогу.",
    "Чтобы не получать приглашения, ответьте СТОП.",
  ].join("\n");
}

/**
 * Не чаще двух приглашений в 30 дней: так обещано гостю в тексте согласия
 * (docs/guest-access.md, раздел 2.1).
 */
export const INVITES_PER_PERIOD = 2;
export const INVITE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Пауза между сообщениями рассылки. Пачка одинаковых сообщений — верный
 * способ получить блокировку номера; полторы секунды — сотня гостей за пару минут.
 */
export const SEND_PAUSE_MS = 1_500;
export const SEND_BATCH = 20;
