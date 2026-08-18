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
  /** Вкладка: за игрой приходят, программу открывают между делом. */
  section: "GAME" | "APP";
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

/** Всё, что показывается на выбранной вкладке. */
export function inSection(apps: LibraryApp[], section: "GAME" | "APP"): LibraryApp[] {
  return apps.filter((app) => app.section === section);
}

/**
 * Жанры для кнопок — только те, что есть на вкладке.
 *
 * Пустые кнопки хуже отсутствующих: гость нажимает и видит пустоту, решая, что
 * система сломана.
 */
export function genres(apps: LibraryApp[]): string[] {
  const seen: string[] = [];
  for (const app of apps) {
    const genre = app.category?.trim() || OTHER;
    if (!seen.includes(genre)) seen.push(genre);
  }
  // «Остальное» уходит в конец: это не жанр, а то, что не разложили.
  return [...seen.filter((g) => g !== OTHER), ...seen.filter((g) => g === OTHER)];
}

export function byGenre(apps: LibraryApp[], genre: string | null): LibraryApp[] {
  if (genre === null) return apps;
  return apps.filter((app) => (app.category?.trim() || OTHER) === genre);
}

/**
 * Отмеченные гостем — первыми.
 *
 * Из сорока игр человек возвращается к двум-трём, и каждый раз искать их среди
 * остальных — лишняя работа за оплаченные минуты.
 */
export function favouritesFirst(apps: LibraryApp[], favourites: string[]): LibraryApp[] {
  const marked = new Set(favourites);
  return [...apps].sort((a, b) => Number(marked.has(b.id)) - Number(marked.has(a.id)));
}
