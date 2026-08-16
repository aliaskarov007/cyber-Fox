import { BrowserWindow, app, globalShortcut, ipcMain } from "electron";
import { join } from "node:path";

/**
 * Агент на игровом ПК.
 *
 * Задача окна — держать экран заблокированным, пока сессия не оплачена, и не
 * дать обойти себя обычными средствами Windows. Полная защита от обхода —
 * отдельная работа (служба, замена оболочки); здесь заложены базовые меры,
 * которых достаточно для обкатки в собственном зале.
 */

const SERVER_URL = process.env.CYBERFOX_SERVER ?? "http://localhost:3000";
const PAIRING_TOKEN = process.env.CYBERFOX_PAIRING_TOKEN ?? "";

let lockWindow: BrowserWindow | null = null;
/** Экран разблокирован сервером: окно можно закрыть и отдать машину гостю. */
let unlocked = false;

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

app.whenReady().then(() => {
  createLockWindow();

  // Сочетания, которыми чаще всего пробуют выйти из киоска.
  for (const accelerator of ["Alt+F4", "Alt+Tab", "Super", "Control+Shift+Escape"]) {
    globalShortcut.register(accelerator, () => {
      if (!unlocked) lockWindow?.focus();
    });
  }

  ipcMain.handle("agent:config", () => ({
    serverUrl: SERVER_URL,
    pairingToken: PAIRING_TOKEN,
    hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "unknown",
  }));

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

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Машина зала не должна оставаться без блокировки, если окно всё-таки закрыли.
app.on("window-all-closed", () => {
  if (!unlocked) createLockWindow();
});
