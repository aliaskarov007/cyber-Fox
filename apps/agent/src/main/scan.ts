import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  type InstalledGame,
  coverUrl,
  dedupe,
  launchUri,
  libraryPaths,
  parseManifest,
} from "../shared/steam-library.js";

/**
 * Разведка: что за игры стоят на этой машине.
 *
 * Всё читается с диска, наружу ничего не спрашивается — работает и без
 * интернета. Steam держит списки в текстовых файлах рядом с собой, и этого
 * достаточно: в клубах почти всё ставится через него.
 */

/**
 * Где искать Steam.
 *
 * В бездисковом зале игры почти всегда лежат не в образе, а на отдельном диске
 * с играми — он общий для всех машин и подключается своей буквой. Поэтому,
 * кроме обычных мест, перебираются частые варианты такого диска, а точный путь
 * задаётся переменной в образе: через точку с запятой их можно указать
 * несколько.
 */
function steamRoots(): string[] {
  const fromEnv = process.env.CYBERFOX_STEAM_PATH;
  if (fromEnv) {
    return fromEnv
      .split(/[;,]/)
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
  }

  const programFiles = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const programFiles64 = process.env.ProgramFiles ?? "C:\\Program Files";

  const roots = [join(programFiles, "Steam"), join(programFiles64, "Steam")];
  for (const drive of ["C", "D", "E", "F", "G"]) {
    roots.push(`${drive}:\\Steam`, `${drive}:\\Games\\Steam`, `${drive}:\\SteamLibrary`);
    // Клубы кладут Steam в свою папку — D:\Online\Steam, D:\Игры\Steam и
    // подобное. Угадать имя нельзя, поэтому смотрим папки первого уровня: их
    // на игровом диске десятки, а не тысячи.
    roots.push(...nestedSteamDirs(`${drive}:\\`));
  }
  return roots;
}

/** Папки вида <диск>\<что-то>\Steam. Глубже не идём: это уже перебор диска. */
function nestedSteamDirs(drive: string): string[] {
  try {
    return readdirSync(drive, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(drive, entry.name, "Steam"))
      .filter((path) => existsSync(path));
  } catch {
    // Диска нет или он недоступен — обычное дело на машине зала.
    return [];
  }
}

function readIfExists(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    // Занятый или недоступный файл не должен ронять разведку: без списка игр
    // машина работает, просто полки заполнит администратор руками.
    return null;
  }
}

/** Игры одной папки библиотеки. */
function gamesIn(libraryPath: string): InstalledGame[] {
  const apps = join(libraryPath, "steamapps");
  let files: string[];
  try {
    files = readdirSync(apps);
  } catch {
    return [];
  }

  const games: InstalledGame[] = [];
  for (const file of files) {
    if (!file.startsWith("appmanifest_") || !file.endsWith(".acf")) continue;
    const content = readIfExists(join(apps, file));
    const game = content ? parseManifest(content) : null;
    if (game) games.push(game);
  }
  return games;
}

export interface ScannedApp {
  name: string;
  target: string;
  coverUrl: string;
}

export function scanInstalled(): ScannedApp[] {
  const found: InstalledGame[] = [];

  for (const root of steamRoots()) {
    const vdf = readIfExists(join(root, "steamapps", "libraryfolders.vdf"));
    // Сам Steam — тоже библиотека, и в vdf он указан не всегда.
    const roots = vdf ? [root, ...libraryPaths(vdf)] : [root];
    for (const library of roots) found.push(...gamesIn(library));
  }

  return dedupe(found).map((game) => ({
    name: game.name,
    target: launchUri(game),
    coverUrl: coverUrl(game),
  }));
}
