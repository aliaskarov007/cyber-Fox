/**
 * Полки оболочки: как каталог клуба превращается в то, что видит гость.
 *
 * Правила отделены от экрана: гость садится играть, а не разбираться в меню,
 * поэтому порядок полок и поведение поиска стоит проверять тестами, а не
 * глазами на одной машине.
 */

export interface LibraryApp {
  id: string;
  name: string;
  category: string | null;
  kind: "EXECUTABLE" | "URI";
  target: string;
  args: string[];
  coverUrl: string | null;
}

export interface Shelf {
  title: string;
  apps: LibraryApp[];
}

/** Полка для игр без своей категории. */
const OTHER = "Остальное";

/**
 * Игры по полкам, в порядке появления категорий в каталоге.
 *
 * Порядок задаёт владелец в кассе через сортировку: то, во что играют каждый
 * день, он ставит первым, и гостю не приходится листать.
 */
export function shelves(apps: LibraryApp[]): Shelf[] {
  const byTitle = new Map<string, LibraryApp[]>();
  for (const app of apps) {
    const title = app.category?.trim() || OTHER;
    byTitle.set(title, [...(byTitle.get(title) ?? []), app]);
  }

  const list = [...byTitle.entries()].map(([title, items]) => ({ title, apps: items }));
  // «Остальное» уходит вниз: это не полка, а то, что не разложили по полкам.
  return [...list.filter((s) => s.title !== OTHER), ...list.filter((s) => s.title === OTHER)];
}

/**
 * Поиск по названию.
 *
 * Регистр и раскладка тут не главное: гость печатает пару букв и ждёт, что
 * список сузится. Совпадение с начала слова важнее совпадения в середине —
 * «кс» должно находить «Counter-Strike», а не строку, где эти буквы случайно
 * встретились внутри.
 */
export function search(apps: LibraryApp[], query: string): LibraryApp[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return apps;

  const scored = apps
    .map((app) => ({ app, score: score(app.name.toLowerCase(), needle) }))
    .filter((item) => item.score > 0);

  scored.sort((a, b) => b.score - a.score || a.app.name.localeCompare(b.app.name));
  return scored.map((item) => item.app);
}

function score(name: string, needle: string): number {
  if (name.startsWith(needle)) return 3;
  if (name.split(/[\s:_-]+/).some((word) => word.startsWith(needle))) return 2;
  return name.includes(needle) ? 1 : 0;
}
