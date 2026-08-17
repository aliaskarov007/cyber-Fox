import { BrowserWindow, app, globalShortcut, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
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

/*
 * Видеоускорение выключено намеренно. На бездисковых клиентах и на машинах с
 * общим драйвером Electron рисует чёрное окно вместо интерфейса, и отличить
 * это от «агент не запустился» на месте нечем. Экран блокировки — статичный
 * текст, ускорять в нём нечего, а игры идут мимо агента и его настройки не
 * касаются.
 */
app.disableHardwareAcceleration();

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

  /*
   * Любой сбой запуска экрана заканчивался чёрным окном: фон экрана блокировки
   * тёмный, и пустая заливка выглядит как выключенный монитор. Администратор в
   * зале не может отличить её ни от зависшей машины, ни от неверного адреса
   * сервера. Поэтому каждый известный сбой выводится словами прямо на экран.
   */
  lockWindow.webContents.on("did-fail-load", (_event, code, description) => {
    showFailure(`Экран агента не загрузился: ${description} (${code})`);
  });

  lockWindow.webContents.on("preload-error", (_event, path, error) => {
    showFailure(`Не поднялся мост настроек: ${error.message}\n${path}`);
  });

  lockWindow.webContents.on("render-process-gone", (_event, details) => {
    showFailure(`Экран агента упал: ${details.reason}`);
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void lockWindow.loadURL(devServer);
  else void lockWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

/**
 * Сообщение о сбое вместо чёрного экрана.
 *
 * Страница собирается здесь, а не берётся файлом из сборки: сбой мог случиться
 * как раз потому, что файлы экрана не читаются.
 */
function showFailure(message: string): void {
  const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0e1015;color:#f2f4f8;font:16px/1.5 system-ui,sans-serif">
    <div style="max-width:52ch;padding:32px">
      <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#d2453c">Cyber-Fox · сбой запуска</div>
      <pre style="white-space:pre-wrap;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;margin:16px 0 24px">${message.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>
      <div style="color:#949cad">Покажите этот текст тому, кто ставил систему. Машина в зал в таком виде не выдаётся.</div>
    </div>
  </body>`;
  void lockWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

/*
 * Второй экземпляр агента — это две блокировки, спорящие за фокус, и два
 * отчёта об одних и тех же минутах. Оставляем работать первый.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/*
 * Ответы экрану регистрируются до готовности приложения и до окна.
 *
 * Раньше они стояли последними в обработчике whenReady, после автозапуска и
 * перехвата сочетаний клавиш. Любой сбой в тех строках оставлял окно уже
 * открытым, но без единого обработчика, и экран получал «No handler registered
 * for agent:config» вместо настроек. Регистрация ничего не требует от системы,
 * поэтому ей незачем зависеть от того, что делается раньше.
 */
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

/*
 * Сервер разрешил игру: снимаем киоск, но окно оставляем на экране.
 *
 * Раньше агент сворачивался, и гость оставался наедине с рабочим столом:
 * ярлыки искал сам, а всё остальное в Windows было открыто. Теперь на его
 * месте оболочка с полками игр, а свернётся окно только когда игра запущена.
 */
ipcMain.handle("agent:unlock", () => {
  if (unlocked) return;
  unlocked = true;
  lockWindow?.setKiosk(false);
  lockWindow?.setAlwaysOnTop(false);
  lockWindow?.setFullScreen(true);
  // Окно создаётся несворачиваемым, иначе блокировку убирали бы одной кнопкой.
  // На время оплаченной сессии сворачивание нужно: под ним запускается игра.
  lockWindow?.setMinimizable(true);
});

/**
 * Запуск игры с полки.
 *
 * Программа отвязывается от агента: перезапуск оболочки не должен убивать
 * запущенную игру, а закрытая игра — оставлять висеть процесс агента.
 */
ipcMain.handle("agent:launch", async (_event, app: { kind: string; target: string; args: string[] }) => {
  if (!unlocked) return { ok: false, reason: "Сессия не оплачена" };

  try {
    if (app.kind === "URI") {
      await shell.openExternal(app.target);
    } else {
      const child = spawn(app.target, app.args ?? [], { detached: true, stdio: "ignore" });
      child.unref();
    }
    // Уводим оболочку с дороги: игра открывается поверх, а вернуться к полкам
    // можно тем же сочетанием, что показано на экране.
    lockWindow?.minimize();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: asText(error) };
  }
});

/** Вернуться к полкам, не закрывая игру. */
ipcMain.handle("agent:shell", () => {
  if (!unlocked) return;
  lockWindow?.restore();
  lockWindow?.focus();
});

/** Время кончилось: возвращаем блокировку поверх игры. */
ipcMain.handle("agent:lock", () => {
  if (!unlocked && lockWindow?.isVisible()) return;
  unlocked = false;
  lockWindow?.restore();
  lockWindow?.setMinimizable(false);
  lockWindow?.setKiosk(true);
  lockWindow?.setAlwaysOnTop(true, "screen-saver");
  lockWindow?.focus();
});

app.whenReady().then(() => {
  // Окно поднимается первым: всё, что идёт следом, может не получиться, и
  // тогда причину надо на чём-то показать.
  createLockWindow();

  try {
    // Агент должен подниматься сам: машину в зале включают кнопкой на корпусе,
    // и никто не станет запускать блокировку вручную на каждой из сорока.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, args: [] });
    }
  } catch (error) {
    showFailure(`Не удалось прописать автозапуск: ${asText(error)}`);
  }

  /*
   * Сочетания, которыми чаще всего пробуют выйти из киоска. Каждое ставится
   * отдельно: часть из них система придерживает за собой — Ctrl+Shift+Esc,
   * например, Windows не отдаёт никому, — и отказ в одном не должен уносить
   * остальные вместе с запуском агента.
   */
  for (const accelerator of ["Alt+F4", "Alt+Tab", "Super", "Control+Shift+Escape"]) {
    try {
      globalShortcut.register(accelerator, () => {
        if (!unlocked) lockWindow?.focus();
      });
    } catch (error) {
      console.error(`Сочетание ${accelerator} не перехвачено: ${asText(error)}`);
    }
  }

  /*
   * Возврат к полкам поверх запущенной игры. Сочетание редкое намеренно: часто
   * используемое гость нажмёт случайно и свернёт себе катку.
   */
  try {
    globalShortcut.register("Control+Alt+Home", () => {
      if (!unlocked) return;
      lockWindow?.restore();
      lockWindow?.focus();
    });
  } catch (error) {
    console.error(`Возврат к полкам не перехвачен: ${asText(error)}`);
  }
});

function asText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

