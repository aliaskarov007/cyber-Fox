/**
 * Номер телефона в одном виде: +7XXXXXXXXXX.
 *
 * Раньше номер сравнивался символ в символ: на стойке записали «+77011234567»,
 * гость за ПК набрал «8 701 123 45 67» — и вход не находил аккаунт. Теперь
 * любая привычная запись казахстанского номера приводится к одной форме до
 * записи и до поиска.
 *
 * Номера других стран (11–15 цифр с кодом) остаются как есть, со знаком +.
 * Возвращает null, если цифр слишком мало, чтобы это был номер.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  // 8 701 ... — местная запись казахстанского номера.
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  // 701 123 45 67 — без кода страны.
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return null;
}

/** Последние четыре цифры — для имени гостя, который его не назвал. */
export function phoneTail(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4);
}
