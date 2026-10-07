/**
 * Набор номера на экране блокировки.
 *
 * +7 уже стоит — гость набирает только десять цифр. Привычную восьмёрку в
 * начале («8 701…») пропускаем молча: казахстанский номер после +7 с неё не
 * начинается, а гость набирает её по привычке и потом стирает весь номер.
 */
export const NATIONAL_LENGTH = 10;

export function addDigit(digits: string, digit: string): string {
  if (!/^\d$/.test(digit)) return digits;
  if (digits.length === 0 && digit === "8") return digits;
  if (digits.length >= NATIONAL_LENGTH) return digits;
  return digits + digit;
}

/** «+7 (701) 123-45-67» по мере набора, с прочерками на месте недостающих цифр. */
export function formatNational(digits: string): string {
  const d = digits.padEnd(NATIONAL_LENGTH, "_");
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

/** Номер для сервера. */
export function fullPhone(digits: string): string {
  return `+7${digits}`;
}
