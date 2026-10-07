import { randomInt } from "node:crypto";

/**
 * Подтверждение номера через WhatsApp: гость сам пишет клубу код с экрана.
 *
 * Номер отправителя подставляет сам WhatsApp — подделать его нельзя, поэтому
 * отдельный код в ответ не нужен, а клуб не пишет первым незнакомому номеру.
 * Гостю не нужно ничего набирать: QR открывает WhatsApp с уже вписанным
 * текстом, остаётся нажать «Отправить».
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
