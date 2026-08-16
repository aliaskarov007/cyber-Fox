/**
 * Разбор CSV для переезда с чужих систем — чистые функции.
 *
 * Выгрузки Senet и SmartShell приходят как есть: с BOM от Excel, точкой с
 * запятой вместо запятой (русская локаль), кавычками внутри полей и пустыми
 * строками в конце. Разбирать это регулярками — значит однажды потерять гостю
 * баланс, поэтому парсер написан явно и покрыт тестами.
 */

export interface CsvTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** Определяет разделитель по первой строке: у русских выгрузок это `;`. */
export function detectDelimiter(line: string): string {
  const candidates = [";", ",", "\t"];
  let best = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = splitLine(line, candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Разбор одной строки с учётом кавычек и удвоенных кавычек внутри поля. */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Удвоенная кавычка внутри значения — это одна кавычка.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

export function parseCsv(input: string): CsvTable {
  // Excel добавляет BOM; без его удаления первый заголовок не совпадёт ни с чем.
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map((h) => h.toLowerCase());

  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });

  return { headers, rows };
}

/** Ищет колонку по нескольким возможным названиям: выгрузки зовут поля по-разному. */
export function pick(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row[name.toLowerCase()];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return "";
}

/**
 * Деньги из выгрузки в тиын.
 *
 * Приходят как «1 500,50», «1500.5», «1 500 ₸». Ошибка здесь — это ошибка
 * в балансе гостя при переезде, поэтому разбор строгий: непонятное значение
 * даёт null, а не ноль.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input
    .replace(/\s| /g, "")
    .replace(/[₸тг]/gi, "")
    .replace(",", ".");
  if (cleaned.length === 0) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Телефон к единому виду: выгрузки пишут его как угодно. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 10) return null;

  // Казахстанские номера: 8 и 7 в начале означают одно и то же.
  const tail = digits.slice(-10);
  return `+7${tail}`;
}
