import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type AgentSettings, EMPTY_SETTINGS } from "../shared/settings.js";

/**
 * Настройки агента на диске.
 *
 * Раньше адрес сервера и код привязки приходили только из переменных окружения.
 * Для разработки это удобно, но на игровую машину так ничего не поставишь:
 * администратор не будет заводить переменные среды на сорока ПК. Поэтому
 * настройки живут в файле рядом с профилем приложения, а вводятся один раз
 * с экрана самого агента.
 */

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

/**
 * Переменные окружения перекрывают файл.
 *
 * Порядок именно такой: разработчик поднимает агента против localhost, не
 * трогая сохранённые настройки, а массовая установка задаёт общий для зала
 * адрес сервера один раз — через переменную среды в образе машины.
 */
export function readSettings(): AgentSettings {
  const file = settingsPath();
  let stored = EMPTY_SETTINGS;

  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<AgentSettings>;
      stored = {
        serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : "",
        pairingToken: typeof parsed.pairingToken === "string" ? parsed.pairingToken : "",
      };
    } catch {
      // Битый файл не должен оставлять зал без блокировки: агент просто
      // попросит настроить себя заново.
      stored = EMPTY_SETTINGS;
    }
  }

  return {
    serverUrl: process.env.CYBERFOX_SERVER ?? stored.serverUrl,
    pairingToken: process.env.CYBERFOX_PAIRING_TOKEN ?? stored.pairingToken,
  };
}

export function writeSettings(settings: AgentSettings): void {
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
