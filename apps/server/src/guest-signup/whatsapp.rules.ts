import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Подтверждение номера через WhatsApp: гость сам пишет клубу код с экрана.
 *
 * Отправлять код гостю мы не стали: каждое исходящее сообщение платформы
 * WhatsApp платное, а входящее — нет. Заодно гостю не нужно ничего набирать:
 * QR открывает WhatsApp с уже вписанным текстом, остаётся нажать «Отправить».
 */

/** Сколько живёт код с экрана. */
export const CODE_TTL_MINUTES = 10;

/** Код из четырёх цифр, без ведущих нулей — их теряют при пересказе. */
export function newCode(): string {
  return String(randomInt(1000, 10000));
}

/**
 * Текст, который подставится в WhatsApp.
 *
 * Латиницей намеренно: кириллица в ссылке кодируется втрое длиннее, QR
 * становится мельче и дольше ловится камерой. Название клуба перед кодом —
 * чтобы гость видел, кому пишет.
 */
export function codeMessage(code: string): string {
  return `Cyber-Fox ${code}`;
}

/** Ссылка, открывающая чат с клубом и готовым сообщением. Её и кодирует QR. */
export function waLink(businessNumber: string, code: string): string {
  const digits = businessNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(codeMessage(code))}`;
}

/** Код из присланного текста: первые четыре цифры подряд. */
export function extractCode(text: string): string | null {
  const match = /(?<!\d)(\d{4})(?!\d)/.exec(text);
  return match ? match[1] : null;
}

/** «СТОП» в ответ — отписка от приглашений. Так обещано гостю при согласии. */
export function isStop(text: string): boolean {
  return /^\s*(стоп|stop|отписаться)\s*[.!]?\s*$/i.test(text);
}

export interface IncomingMessage {
  /** Номер отправителя так, как его отдаёт WhatsApp: цифры с кодом страны. */
  from: string;
  text: string;
}

/**
 * Текстовые сообщения из вебхука WhatsApp Cloud API.
 *
 * Статусы доставки, картинки и прочее приходят тем же вебхуком — их
 * пропускаем: подтверждать номер ими нечем.
 */
export function parseIncoming(payload: unknown): IncomingMessage[] {
  const result: IncomingMessage[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return result;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } }).value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const m = message as { from?: unknown; type?: unknown; text?: { body?: unknown } };
        if (m.type === "text" && typeof m.from === "string" && typeof m.text?.body === "string") {
          result.push({ from: m.from, text: m.text.body });
        }
      }
    }
  }
  return result;
}

/**
 * Подпись Meta: HMAC-SHA256 тела запроса ключом приложения.
 *
 * Без проверки любой, кто знает адрес вебхука, подтвердил бы себе чужой номер
 * одним запросом.
 */
export function signatureValid(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}
