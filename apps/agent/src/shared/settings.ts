/**
 * Разбор того, что администратор вводит на экране настройки агента.
 *
 * Правила живут отдельно от Electron: их вызывает и основной процесс при
 * чтении файла, и экран настройки при вводе, и тесты — без запуска окна.
 */

export interface AgentSettings {
  /** Адрес облака, например https://club.cyberfox.kz */
  serverUrl: string;
  /** Код привязки конкретной машины — выдаётся в админке. */
  pairingToken: string;
}

export const EMPTY_SETTINGS: AgentSettings = { serverUrl: "", pairingToken: "" };

/**
 * Адрес внутри локальной сети клуба: IP из частных диапазонов или localhost.
 *
 * Такой сервер стоит в самом зале, сертификата у него нет и быть не может —
 * удостоверяющие центры не выдают их на 192.168.*.
 */
function isLocalAddress(host: string): boolean {
  const name = host.split(":")[0].toLowerCase();
  if (name === "localhost") return true;
  const parts = name.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Нормализация адреса сервера.
 *
 * Адрес печатают руками с листка, поэтому мы прощаем хвостовой слэш и
 * отсутствие схемы. Схему по умолчанию дописываем `https`: агент ходит в облако
 * через интернет, и молчаливый откат на `http` означал бы пароли и коды
 * привязки открытым текстом.
 *
 * Исключение — сервер в локальной сети зала. На адрес вида 192.168.1.50
 * сертификат не выдаётся, поэтому `https` там гарантированно не соединится, а
 * администратор будет искать причину в сети. Данные при этом не выходят за
 * пределы клуба.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${isLocalAddress(trimmed) ? "http" : "https"}://${trimmed}`;
}

/** Код привязки печатают с листа: пробелы и регистр значения не имеют. */
export function normalizePairingToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

export function isConfigured(settings: AgentSettings): boolean {
  return settings.serverUrl.length > 0 && settings.pairingToken.length > 0;
}

/** Что не так с введённым — сообщением, которое читает администратор. */
export function validate(settings: AgentSettings): string | null {
  if (settings.serverUrl.length === 0) return "Укажите адрес сервера";
  try {
    new URL(settings.serverUrl);
  } catch {
    return "Адрес сервера не похож на ссылку";
  }
  if (settings.pairingToken.length === 0) return "Укажите код привязки этой машины";
  return null;
}
