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
 * Нормализация адреса сервера.
 *
 * Адрес печатают руками с листка, поэтому мы прощаем хвостовой слэш и
 * отсутствие схемы. Схему дописываем именно `https`: агент ходит в облако через
 * интернет, и молчаливый откат на `http` означал бы пароли и коды привязки
 * открытым текстом.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
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
