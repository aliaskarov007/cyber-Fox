import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { allDrivesExcept } from "../shared/drive-mask.js";

const run = promisify(execFile);

/**
 * Что гость не может делать во время оплаченной сессии.
 *
 * Оболочка показывает полки, но Windows под ней никуда не делся: из любого
 * окна открывался проводник, а из него — диски, чужие сохранения и папка с
 * самим агентом. Здесь ставятся политики, которые это закрывают, и снимаются,
 * когда сессия закончилась.
 *
 * Это не защита от подготовленного гостя: политики живут в его же ветке
 * реестра, и тот, кто дошёл до regedit, снимет их сам. Настоящая изоляция —
 * пароль на BIOS, запрет загрузки с флешки и групповые политики в образе
 * (docs/install-diskless.md). Здесь закрывается то, что гость делает не со зла,
 * а потому что оно открылось.
 */

/** Ветка политик проводника у текущего пользователя. */
const POLICY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer";
const SYSTEM_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";

/**
 * Диск с играми остаётся видимым: гость должен доходить до сохранений и
 * скриншотов, иначе клуб получает поток вопросов на стойку.
 */
const VISIBLE_DRIVES = (process.env.CYBERFOX_VISIBLE_DRIVES ?? "C,D").split(",");

interface Policy {
  key: string;
  name: string;
  value: number;
  /** Зачем — чтобы правку было видно не только по имени ключа. */
  why: string;
}

function policies(): Policy[] {
  return [
    {
      key: POLICY_KEY,
      name: "NoDrives",
      value: allDrivesExcept(VISIBLE_DRIVES),
      why: "прячет чужие диски в проводнике",
    },
    {
      key: POLICY_KEY,
      name: "NoViewOnDrive",
      value: allDrivesExcept(VISIBLE_DRIVES),
      why: "закрывает их и по прямому адресу вида E:\\",
    },
    { key: POLICY_KEY, name: "NoRun", value: 1, why: "убирает «Выполнить»" },
    { key: POLICY_KEY, name: "NoFolderOptions", value: 1, why: "прячет настройки папок" },
    { key: POLICY_KEY, name: "NoControlPanel", value: 1, why: "закрывает панель управления" },
    {
      key: SYSTEM_KEY,
      name: "DisableRegistryTools",
      value: 1,
      why: "закрывает regedit, которым снимаются эти же политики",
    },
    {
      key: SYSTEM_KEY,
      name: "DisableCMD",
      value: 2,
      why: "закрывает командную строку, оставляя работать .bat запуска игр",
    },
  ];
}

/** На других системах политик Windows нет — молча ничего не делаем. */
const isWindows = process.platform === "win32";

async function reg(args: string[]): Promise<void> {
  await run("reg.exe", args, { windowsHide: true });
}

/**
 * Поставить запреты. Ошибка любой политики не должна ронять сессию: гость уже
 * заплатил, и лучше пустить его играть с открытым проводником, чем не пустить
 * вовсе. Каждая неудача уходит в журнал.
 */
export async function applyLockdown(): Promise<void> {
  if (!isWindows) return;

  for (const policy of policies()) {
    try {
      await reg(["add", policy.key, "/v", policy.name, "/t", "REG_DWORD", "/d", String(policy.value), "/f"]);
    } catch (error) {
      console.error(`Политика ${policy.name} (${policy.why}) не применилась: ${text(error)}`);
    }
  }

  await refreshExplorer();
}

/**
 * Снять запреты. Вызывается и при блокировке, и при запуске агента: если
 * прошлая сессия оборвалась падением, машина не должна остаться запертой.
 */
export async function releaseLockdown(): Promise<void> {
  if (!isWindows) return;

  for (const policy of policies()) {
    try {
      await reg(["delete", policy.key, "/v", policy.name, "/f"]);
    } catch {
      // Отсутствие значения — обычное дело: снимать нечего.
    }
  }

  await refreshExplorer();
}

/*
 * Политики читаются проводником при старте, поэтому его перезапускают. Игры это
 * не трогает: они живут своими процессами и переживают смену оболочки.
 */
async function refreshExplorer(): Promise<void> {
  try {
    await run("taskkill.exe", ["/f", "/im", "explorer.exe"], { windowsHide: true });
  } catch {
    // Проводник мог быть уже закрыт — тогда и убивать нечего.
  }
  try {
    // Запускаем обратно: без него пропадёт панель задач, а вместе с ней и
    // способ добраться до чего-либо, если агент упадёт.
    await run("cmd.exe", ["/c", "start", "explorer.exe"], { windowsHide: true });
  } catch (error) {
    console.error(`Проводник не перезапустился: ${text(error)}`);
  }
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
