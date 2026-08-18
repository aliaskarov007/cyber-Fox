/**
 * Обложка по ссылке запуска Steam.
 *
 * Владельцу клуба не приходится искать картинку руками: он вставляет
 * steam://rungameid/730, а обложка подставляется с раздачи Steam. Для игр вне
 * Steam поле остаётся пустым и заполняется ссылкой вручную.
 */

const STEAM_URI = /^steam:\/\/(?:rungameid|run)\/(\d+)/i;
/*
 * Запуск через сам steam.exe с аргументом: так тоже делают, и обложку тогда
 * надо доставать из аргумента, а не из пути.
 */
const STEAM_APPLAUNCH = /-applaunch\s+(\d+)/i;
/** Ссылка на магазин тоже годится: её проще скопировать из браузера. */
const STEAM_STORE = /store\.steampowered\.com\/app\/(\d+)/i;

/** Числовой идентификатор игры в Steam или null, если это не Steam. */
export function steamAppId(target: string, args = ""): string | null {
  const value = `${target.trim()} ${args}`;
  return (
    STEAM_URI.exec(value)?.[1] ?? STEAM_STORE.exec(value)?.[1] ?? STEAM_APPLAUNCH.exec(value)?.[1] ?? null
  );
}

/**
 * Вертикальная обложка 600×900 — та же, что Steam показывает в библиотеке.
 * Полки оболочки выстроены под неё: гость узнаёт игру по картинке, а не читает
 * подписи.
 */
export function steamCoverUrl(target: string, args = ""): string | null {
  const appId = steamAppId(target, args);
  return appId === null
    ? null
    : `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
}

/** Ссылка запуска по идентификатору: владелец может ввести просто число. */
export function steamRunUri(appId: string): string {
  return `steam://rungameid/${appId}`;
}

/**
 * Путь ведёт в сам Steam, а не в игру.
 *
 * Частая ошибка при заполнении руками: нажатие по такой плитке открывает
 * клиент Steam, и гость ищет игру сам — то есть ровно то, ради ухода от чего
 * полки и делались.
 */
export function pointsAtSteamItself(target: string, args = ""): boolean {
  const path = target.trim().toLowerCase();
  const looksLikeSteamExe = path.endsWith("steam.exe") || path.endsWith("steam");
  return looksLikeSteamExe && steamAppId(target, args) === null;
}
