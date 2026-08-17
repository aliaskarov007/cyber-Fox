import { BrowserWindow, app, globalShortcut, ipcMain } from "electron";
import { join } from "node:path";

import { type AgentSettings, isConfigured } from "../shared/settings.js";
import { machineMac, readSettings, writeSettings } from "./config.js";

/**
 * Агент на игровом ПК.
 *
 * Задача окна — держать экран заблокированным, пока сессия не оплачена, и не
 * дать обойти себя обычными средствами Windows. Полная защита от обхода —
 * отдельная работа (служба, замена оболочки); здесь заложены базовые меры,
 * которых достаточно для обкатки в собственном зале.
 */

let lockWindow: BrowserWindow | null = null;
/** Экран разблокирован сервером: окно можно закрыть и отдать машину гостю. */
let unlocked = false;
/** Пользователь закрывает агента осознанно — только при выходе из системы. */
let quitting = false;

function createLockWindow(): void {
  lockWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    kiosk: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    closable: false,
    minimizable: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  lockWindow.setAlwaysOnTop(true, "screen-saver");
  lockWindow.setVisibleOnAllWorkspaces(true);

  // Выключение и перезагрузку Windows агент не держит: смена не должна
  // заканчиваться спором с машиной, которая отказывается выключаться.
  lockWindow.on("session-end", () => {
    quitting = true;
    app.quit();
  });

  // Пока сессия не начата, окно возвращает себе фокус: свернуть блокировку
  // и сесть играть бесплатно не должно получаться.
  lockWindow.on("blur", () => {
    if (!unlocked && lockWindow) {
      lockWindow.focus();
      lockWindow.setAlwaysOnTop(true, "screen-saver");
    }
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void lockWindow.loadURL(devServer);
  else void lockWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

/*
 * Второй экземпляр агента — это две блокировки, спорящие за фокус, и два
 * отчёта об одних и тех же минутах. Оставляем работать первый.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(() => {
  // Агент должен подниматься сам: машину в зале включают кнопкой на корпусе,
  // и никто не станет запускать блокировку вручную на каждой из сорока.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, args: [] });
  }

  createLockWindow();

  // Сочетания, которыми чаще всего пробуют выйти из киоска.
  for (const accelerator of ["Alt+F4", "Alt+Tab", "Super", "Control+Shift+Escape"]) {
    globalShortcut.register(accelerator, () => {
      if (!unlocked) lockWindow?.focus();
    });
  }

  ipcMain.handle("agent:config", () => {
    const settings = readSettings();
    return {
      ...settings,
      hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "unknown",
      // В бездисковом зале имя и настройки у машин общие, поэтому себя они
      // называют MAC-адресом.
      macAddress: machineMac(),
      configured: isConfigured(settings),
    };
  });

  /*
   * Настройку машины делает администратор при установке. Перезагружаем окно
   * вместо переподключения сокета: заново пройти весь путь запуска надёжнее,
   * чем чинить состояние экрана после смены сервера.
   */
  ipcMain.handle("agent:save-config", (_event, settings: AgentSettings) => {
    writeSettings(settings);
    lockWindow?.reload();
  });

  /*
   * Обе команды идемпотентны: старт сессии приходит и событием, и первым тиком,
   * а после переподключения сокета повторяется. Переключать режим киоска на
   * каждое такое сообщение — значит моргать окном поверх чужой игры.
   */

  /** Сервер разрешил игру: снимаем киоск и уводим окно с глаз. */
  ipcMain.handle("agent:unlock", () => {
    if (unlocked) return;
    unlocked = true;
    lockWindow?.setKiosk(false);
    lockWindow?.setAlwaysOnTop(false);
    lockWindow?.minimize();
  });

  /** Время кончилось: возвращаем блокировку поверх игры. */
  ipcMain.handle("agent:lock", () => {
    if (!unlocked && lockWindow?.isVisible()) return;
    unlocked = false;
    lockWindow?.restore();
    lockWindow?.setKiosk(true);
    lockWindow?.setAlwaysOnTop(true, "screen-saver");
    lockWindow?.focus();
  });
});

/*
 * Пока экран заблокирован, выйти из агента нельзя: Alt+F4 по окну и «Закрыть»
 * из панели задач не должны отдавать машину бесплатно. Это не защита от
 * диспетчера задач — тот закрывает процесс мимо Electron, и разбирается с ним
 * служба-сторож (см. docs/deploy.md).
 */
app.on("before-quit", (event) => {
  if (!unlocked && !quitting) event.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Машина зала не должна оставаться без блокировки, если окно всё-таки закрыли.
app.on("window-all-closed", () => {
  if (!unlocked) createLockWindow();
});

