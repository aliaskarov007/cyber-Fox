import { extname } from "node:path";

/**
 * Имя файла обложки на диске.
 *
 * Собственное имя, а не присланное: в имени файла может приехать что угодно —
 * пути наружу, кавычки, чужой язык. Расширение оставляем только из списка
 * разрешённых, потому что по нему браузер решает, как файл показывать.
 */

const ALLOWED = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

/** Разрешён ли такой файл вообще. */
export function isAllowedCover(mimetype: string): boolean {
  return ALLOWED.has(mimetype.toLowerCase());
}

/** Расширение по типу файла, а не по тому, что написал отправитель. */
export function coverExtension(mimetype: string, originalName: string): string {
  const byType = ALLOWED.get(mimetype.toLowerCase());
  if (byType) return byType;

  // Тип не распознан — берём расширение, но только из разрешённых.
  const guess = extname(originalName).toLowerCase();
  return [...ALLOWED.values()].includes(guess) ? guess : ".jpg";
}

/** Имя файла: случайное, без следов присланного. */
export function coverFileName(id: string, mimetype: string, originalName: string): string {
  return `${id}${coverExtension(mimetype, originalName)}`;
}
