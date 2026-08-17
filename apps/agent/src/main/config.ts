import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";

import { pickMac } from "../shared/machine.js";
import { type AgentSettings, EMPTY_SETTINGS } from "../shared/settings.js";

/**
 * Настройки агента: откуда берутся и почему именно оттуда.
 *
 * Источников три, и они перекрывают друг друга сверху вниз:
 *
 *   1. Переменные окружения — разработка и массовая раскатка из образа машины.
 *   2. Файл рядом с программой — то, что переживает перезагрузку бездискового
 *      ПК. Профиль пользователя там стирается вместе с кэшем записи, а папка
 *      программы — часть общего образа, и админ кладёт файл туда один раз.
 *   3. Файл в профиле — обычная машина с диском, настроенная руками с экрана.
 *
 * Порядок именно такой: общий образ задаёт зал целиком, а ручная настройка
 * остаётся возможной там, где образа нет.
 */

/** Имя файла настроек в папке программы — его кладут в образ. */
const IMAGE_FILE = "cyberfox.json";

function profilePath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function imagePath(): string {
  // dirname(exe) — папка установки; в разработке это папка electron, там файла
  // просто не будет, и источник молча пропускается.
  return join(dirname(app.getPath("exe")), IMAGE_FILE);
}

function readFile(file: string): Partial<AgentSettings> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Partial<AgentSettings>;
  } catch {
    // Битый файл не должен оставлять зал без блокировки: агент просто попросит
    // настроить себя заново.
    return {};
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function readSettings(): AgentSettings {
  const image = readFile(imagePath());
  const profile = readFile(profilePath());

  const pick = (key: keyof AgentSettings, env: string | undefined): string =>
    env ?? (text(profile[key]) || text(image[key]) || EMPTY_SETTINGS[key]);

  return {
    serverUrl: pick("serverUrl", process.env.CYBERFOX_SERVER),
    pairingToken: pick("pairingToken", process.env.CYBERFOX_PAIRING_TOKEN),
    enrollmentKey: pick("enrollmentKey", process.env.CYBERFOX_ENROLLMENT_KEY),
  };
}

/** Ручная настройка пишется в профиль: папка программы бывает только для чтения. */
export function writeSettings(settings: AgentSettings): void {
  const file = profilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * MAC, которым машина представляется серверу.
 *
 * В бездисковом зале это единственный устойчивый признак: имя, профиль и
 * настройки у всех машин общие, потому что образ один.
 */
export function machineMac(): string {
  const adapters = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).map((entry) => ({
      name,
      mac: entry.mac,
      internal: entry.internal,
      family: String(entry.family),
    })),
  );
  return pickMac(adapters) ?? "";
}
