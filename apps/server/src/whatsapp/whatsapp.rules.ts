/**
 * Правила WhatsApp-канала без обращений к сети и базе: разбор номеров,
 * ответов гостей и входящих уведомлений Green-API, тексты сообщений.
 */

/**
 * Приводит номер к виду, который понимает WhatsApp: только цифры, с кодом страны.
 *
 * На стойке номер вводят как придётся: «+7 701 123-45-67», «87011234567»,
 * «7011234567». Для Казахстана и России все три — один и тот же номер.
 * Возвращает null, если номер разобрать нельзя: отправлять «наугад» хуже,
 * чем не отправлять, — сообщение уйдёт постороннему.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return digits;
  // Без кода страны: казахстанские мобильные начинаются с 7, российские — с 9.
  if (digits.length === 10 && (digits.startsWith("7") || digits.startsWith("9"))) {
    return `7${digits}`;
  }
  // Номера других стран вводят сразу с кодом: от 11 до 15 цифр по E.164.
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("8")) return digits;

  return null;
}

/** Идентификатор чата Green-API для личного номера. */
export function toChatId(phone: string): string | null {
  const normalized = normalizePhone(phone);
  return normalized ? `${normalized}@c.us` : null;
}

/** Номер отправителя из идентификатора чата; группы (`@g.us`) не принимаем. */
export function phoneFromChatId(chatId: string): string | null {
  const match = /^(\d{10,15})@c\.us$/.exec(chatId);
  return match ? match[1] : null;
}

/** Два номера — один человек, даже если записаны по-разному. */
export function samePhone(a: string, b: string): boolean {
  const left = normalizePhone(a);
  return left !== null && left === normalizePhone(b);
}

export type InviteReply = "going" | "declined" | "stop" | "start";

/**
 * Что гость ответил на приглашение.
 *
 * Гости отвечают коротко и как попало: «1», «да!», «Иду», «👍». Распознаём
 * только однозначное; всё остальное — обычная переписка, на неё не отвечаем
 * автоматически, чтобы бот не спорил с человеком.
 */
export function parseInviteReply(text: string): InviteReply | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.!,)(\s]+$/u, "")
    .replace(/^[\s.!,]+/u, "");

  if (cleaned.length === 0 || cleaned.length > 20) return null;

  if (["стоп", "stop", "отписаться", "отписка"].includes(cleaned)) return "stop";
  if (["старт", "start", "подписаться"].includes(cleaned)) return "start";
  if (["1", "да", "иду", "буду", "приду", "+", "yes", "ok", "ок", "👍", "go"].includes(cleaned)) {
    return "going";
  }
  if (["2", "нет", "не иду", "не буду", "не приду", "-", "no", "👎"].includes(cleaned)) {
    return "declined";
  }
  return null;
}

/** Входящее сообщение, вытащенное из уведомления Green-API. */
export interface IncomingMessage {
  instanceId: string;
  phone: string;
  text: string;
}

/**
 * Разбирает уведомление Green-API.
 *
 * Интересуют только входящие текстовые сообщения из личных чатов; статусы
 * доставки, звонки и группы молча пропускаются — на них webhook тоже приходит.
 */
export function readIncoming(payload: unknown): IncomingMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    typeWebhook?: string;
    instanceData?: { idInstance?: number | string };
    senderData?: { chatId?: string; sender?: string };
    messageData?: {
      typeMessage?: string;
      textMessageData?: { textMessage?: string };
      extendedTextMessageData?: { text?: string };
    };
  };

  if (body.typeWebhook !== "incomingMessageReceived") return null;

  const instanceId = body.instanceData?.idInstance;
  const chatId = body.senderData?.chatId ?? "";
  const phone = phoneFromChatId(chatId);
  const text =
    body.messageData?.textMessageData?.textMessage ??
    body.messageData?.extendedTextMessageData?.text;

  if (instanceId === undefined || !phone || typeof text !== "string") return null;
  return { instanceId: String(instanceId), phone, text };
}

/** Срок жизни кода подтверждения. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Сколько раз можно ошибиться с одним кодом. */
export const CODE_MAX_ATTEMPTS = 5;
/** Не чаще одного кода в минуту: WhatsApp банит номера, которые шлют пачками. */
export const CODE_RESEND_MS = 60 * 1000;

export type CodeCheck = "ok" | "expired" | "locked" | "used" | "wrong";

/**
 * Можно ли принять код. Порядок проверок важен: использованный и
 * просроченный код не должен отвечать «неверный» — это подсказка для перебора.
 */
export function checkCode(
  record: { expiresAt: Date; attempts: number; consumedAt: Date | null },
  matches: boolean,
  now: Date,
): CodeCheck {
  if (record.consumedAt) return "used";
  if (record.expiresAt.getTime() <= now.getTime()) return "expired";
  if (record.attempts >= CODE_MAX_ATTEMPTS) return "locked";
  return matches ? "ok" : "wrong";
}

export function codeMessage(code: string, networkName: string): string {
  return `${code} — код подтверждения номера в ${networkName}. Никому его не сообщайте, кроме администратора на стойке.`;
}

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

export function inviteMessage(event: {
  title: string;
  description: string | null;
  startsAt: Date;
  clubName: string;
  clubCity: string | null;
  timezone: string;
  guestName: string;
}): string {
  const firstName = event.guestName.trim().split(/\s+/)[0] ?? "";
  const place = event.clubCity ? `${event.clubName}, ${event.clubCity}` : event.clubName;

  return [
    firstName ? `${firstName}, приглашаем на ивент!` : "Приглашаем на ивент!",
    "",
    `🎮 ${event.title}`,
    `📍 ${place}`,
    `🕒 ${formatEventTime(event.startsAt, event.timezone)}`,
    ...(event.description ? ["", event.description.trim()] : []),
    "",
    "Ответьте 1 — приду, 2 — не смогу.",
    "Чтобы не получать приглашения, ответьте СТОП.",
  ].join("\n");
}

export function replyAck(reply: InviteReply, eventTitle: string | null): string {
  switch (reply) {
    case "going":
      return eventTitle ? `Записали вас на «${eventTitle}». Ждём!` : "Спасибо, записали!";
    case "declined":
      return eventTitle ? `Поняли, на «${eventTitle}» не ждём. Увидимся в другой раз!` : "Поняли, спасибо!";
    case "stop":
      return "Вы отписались от приглашений. Чтобы снова их получать, напишите СТАРТ.";
    case "start":
      return "Вы снова будете получать приглашения на ивенты.";
  }
}

// --- Регистрация за игровым ПК ---

/** Без похожих друг на друга знаков: 0/O, 1/I/L гость на экране перепутает. */
export const SIGNUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** QR живёт десять минут: дольше гость у экрана не стоит. */
export const SIGNUP_TTL_MS = 10 * 60 * 1000;

/** Код вида CF-7K2Q. random — источник случайности, чтобы правило проверялось без него. */
export function makeSignupCode(random: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += SIGNUP_ALPHABET[random(SIGNUP_ALPHABET.length)];
  return `CF-${code}`;
}

/**
 * Код регистрации в сообщении гостя. Ищем внутри текста: WhatsApp присылает
 * его вместе с подготовленной фразой, а кто-то допишет «привет» от себя.
 */
export function findSignupCode(text: string): string | null {
  const match = /(?:^|[^A-Z0-9])CF[-\s]?([2-9A-HJ-NP-Z]{4})(?![A-Z0-9])/i.exec(text);
  return match ? `CF-${match[1].toUpperCase()}` : null;
}

/** Ссылка, которая открывает WhatsApp с готовым сообщением на номер клуба. */
export function signupLink(clubPhone: string, code: string, clubName: string): string {
  const text = `Регистрация в ${clubName}: ${code}`;
  return `https://wa.me/${clubPhone}?text=${encodeURIComponent(text)}`;
}

/** Имя или ник гостя: без лишних пробелов, от 2 до 24 знаков. */
export function cleanNickname(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length >= 2 && cleaned.length <= 24 ? cleaned : null;
}

export function signupConfirmedMessage(computerName: string, existingName: string | null): string {
  return existingName
    ? `Номер подтверждён ✅ Вернитесь к ${computerName} и задайте новый PIN для аккаунта «${existingName}».`
    : `Номер подтверждён ✅ Вернитесь к ${computerName}: осталось ввести ник и придумать PIN.`;
}
