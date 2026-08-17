/**
 * Обложка по ссылке запуска Steam.
 *
 * Владельцу клуба не приходится искать картинку руками: он вставляет
 * steam://rungameid/730, а обложка подставляется с раздачи Steam. Для игр вне
 * Steam поле остаётся пустым и заполняется ссылкой вручную.
 */

const STEAM_URI = /^steam:\/\/(?:rungameid|run)\/(\d+)/i;
/** Ссылка на магазин тоже годится: её проще скопировать из браузера. */
const STEAM_STORE = /store\.steampowered\.com\/app\/(\d+)/i;

/** Числовой идентификатор игры в Steam или null, если это не Steam. */
export function steamAppId(target: string): string | null {
  const value = target.trim();
  return STEAM_URI.exec(value)?.[1] ?? STEAM_STORE.exec(value)?.[1] ?? null;
}

/**
 * Вертикальная обложка 600×900 — та же, что Steam показывает в библиотеке.
 * Полки оболочки выстроены под неё: гость узнаёт игру по картинке, а не читает
 * подписи.
 */
export function steamCoverUrl(target: string): string | null {
  const appId = steamAppId(target);
  return appId === null
    ? null
    : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
}

/** Ссылка запуска по идентификатору: владелец может ввести просто число. */
export function steamRunUri(appId: string): string {
  return `steam://rungameid/${appId}`;
}
