import { autoUpdater } from "electron-updater";

import { canUpdate, skipReason } from "../shared/update-rules.js";
import { readSettings } from "./config.js";

/**
 * Обновление агента без похода по машинам.
 *
 * Новая версия берётся из выпуска на GitHub — оттуда же, откуда её скачивают
 * руками. Ставится молча и только тогда, когда машина свободна: перезапуск
 * посреди оплаченной игры гость воспримет как поломку.
 */

/** Раз в шесть часов: чаще незачем, выпуски выходят реже. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let playing = false;

/** Сессия началась или кончилась — обновление ждёт свободной машины. */
export function setPlaying(value: boolean): void {
  playing = value;
}

function state(): { playing: boolean; diskless: boolean } {
  // Ключ клуба в настройках означает общий образ: такие машины обновляются
  // правкой образа, а не сами.
  return { playing, diskless: readSettings().enrollmentKey.length > 0 };
}

export function startUpdater(): void {
  // Скачивание и установка руками: иначе обновление приедет и встанет в самый
  // неподходящий момент.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    console.log(`Есть версия ${info.version}`);
    const reason = skipReason(state());
    if (reason) {
      console.log(`Обновление отложено: ${reason}`);
      return;
    }
    void autoUpdater.downloadUpdate();
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (!canUpdate(state())) {
      console.log("Обновление скачано и ждёт: машина занята");
      return;
    }
    console.log(`Ставим версию ${info.version}`);
    // Тихо и без вопросов: за игровым ПК некому нажимать «Далее».
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on("error", (error) => {
    // Недоступный интернет не должен ронять агента: блокировка важнее свежести.
    console.error(`Проверка обновлений не удалась: ${error.message}`);
  });

  const check = (): void => {
    if (!canUpdate(state())) return;
    void autoUpdater.checkForUpdates().catch(() => null);
  };

  check();
  setInterval(check, CHECK_EVERY_MS);
}
