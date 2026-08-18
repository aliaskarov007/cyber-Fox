/**
 * Что установлено на машине зала.
 *
 * Steam держит список установленных игр в текстовых файлах рядом с собой:
 * libraryfolders.vdf перечисляет папки библиотек, а в каждой лежат
 * appmanifest_<appid>.acf с названием игры. Ничего запрашивать у Steam не
 * нужно — всё уже на диске, и работает это без интернета.
 *
 * Разбор отделён от чтения файлов: формат чужой, ошибиться в нём легко, а
 * проверить на настоящей машине зала можно только съездив в зал.
 */

export interface InstalledGame {
  /** Идентификатор игры в Steam: по нему берётся обложка. */
  appId: string;
  name: string;
}

/**
 * Пути библиотек из libraryfolders.vdf.
 *
 * Формат — вложенные кавычки, где у каждой библиотеки есть ключ "path".
 * Читаем только его: остальное меняется от версии к версии.
 */
export function libraryPaths(vdf: string): string[] {
  const paths: string[] = [];
  const pattern = /"path"\s+"([^"]+)"/g;
  let match = pattern.exec(vdf);
  while (match !== null) {
    // В файле пути записаны с двойными обратными слэшами.
    paths.push(match[1].replace(/\\\\/g, "\\"));
    match = pattern.exec(vdf);
  }
  return paths;
}

/**
 * Игра из appmanifest_*.acf.
 *
 * Возвращает null, если в файле нет имени или идентификатора: недокачанная или
 * побитая запись не должна превращаться в пустую плитку на полке.
 */
export function parseManifest(acf: string): InstalledGame | null {
  const appId = /"appid"\s+"(\d+)"/i.exec(acf)?.[1];
  const name = /"name"\s+"([^"]+)"/i.exec(acf)?.[1];
  if (!appId || !name) return null;
  return { appId, name: name.trim() };
}

/** Ссылка запуска для найденной игры. */
export function launchUri(game: InstalledGame): string {
  return `steam://rungameid/${game.appId}`;
}

/**
 * Обложка с раздачи Steam — та же, что игра показывает в библиотеке.
 * Скачивать и хранить её у себя незачем: она и так лежит в интернете.
 */
export function coverUrl(game: InstalledGame): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}/library_600x900.jpg`;
}

/** Игры без повторов: одна и та же может стоять в двух библиотеках. */
export function dedupe(games: InstalledGame[]): InstalledGame[] {
  const byId = new Map<string, InstalledGame>();
  for (const game of games) if (!byId.has(game.appId)) byId.set(game.appId, game);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
