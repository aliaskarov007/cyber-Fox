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

/*
 * Политики пишутся в две ветки сразу.
 *
 * Исторически они лежали в CurrentVersion\Policies, и Windows их оттуда читает
 * до сих пор; современная групповая политика пишет в Software\Policies. Какая из
 * веток сработает на конкретной сборке, заранее не скажешь, а незакрытый
 * проводник в зале дороже двух лишних записей в реестр.
 */
const EXPLORER_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer",
  "HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer",
];
const SYSTEM_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
  "HKCU\\Software\\Policies\\Microsoft\\Windows\\System",
];

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

/** Одна политика в каждую из подходящих ей веток. */
function spread(keys: string[], name: string, value: number, why: string): Policy[] {
  return keys.map((key) => ({ key, name, value, why }));
}

function policies(): Policy[] {
  const hidden = allDrivesExcept(VISIBLE_DRIVES);
  return [
    ...spread(EXPLORER_KEYS, "NoDrives", hidden, "прячет чужие диски в проводнике"),
    ...spread(EXPLORER_KEYS, "NoViewOnDrive", hidden, "закрывает их и по прямому адресу вида E:\\"),
    ...spread(EXPLORER_KEYS, "NoRun", 1, "убирает «Выполнить»"),
    ...spread(EXPLORER_KEYS, "NoFolderOptions", 1, "прячет настройки папок"),
    ...spread(EXPLORER_KEYS, "NoControlPanel", 1, "закрывает панель управления"),
    ...spread(
      SYSTEM_KEYS,
      "DisableRegistryTools",
      1,
      "закрывает regedit, которым снимаются эти же политики",
    ),
    ...SYSTEM_KEYS.map((key) => ({
      /*
       * Единица, а не двойка. Двойка закрывает вместе с командной строкой и
       * обработку .bat, а через них запускается часть игр и лаунчеров — в том
       * числе тем самым spawn, которым агент открывает игру с полки. Гость
       * оплатил бы сессию и получил зал, где половина полок не открывается.
       */
      key,
      name: "DisableCMD",
      value: 1,
      why: "закрывает командную строку, оставляя работать .bat запуска игр",
    })),
  ];
}

/** На других системах политик Windows нет — молча ничего не делаем. */
const isWindows = process.platform === "win32";

async function reg(args: string[]): Promise<void> {
  await run("reg.exe", args, { windowsHide: true });
}

/**
 * Что стояло в ключе до нас.
 *
 * Нужно, чтобы снятие запретов не выглядело как «удалить всё, что там лежит».
 * Те же самые имена значений использует настоящая групповая политика, и на
 * машине в домене агент стёр бы корпоративные ограничения до следующего входа
 * в систему.
 */
const previous = new Map<string, number | null>();

async function readValue(key: string, name: string): Promise<number | null> {
  try {
    const { stdout } = await run("reg.exe", ["query", key, "/v", name], { windowsHide: true });
    const match = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout);
    return match ? Number.parseInt(match[1], 16) : null;
  } catch {
    // Значения нет — так и запомним: снимая запреты, мы его удалим.
    return null;
  }
}

/**
 * Поставить запреты. Ошибка любой политики не должна ронять сессию: гость уже
 * заплатил, и лучше пустить его играть с открытым проводником, чем не пустить
 * вовсе. Каждая неудача уходит в журнал.
 */
export async function applyLockdown(): Promise<void> {
  if (!isWindows) return;

  for (const policy of policies()) {
    const slot = `${policy.key}\\${policy.name}`;
    try {
      // Запоминаем прежнее значение один раз за сессию: повторный вызов не
      // должен запомнить наше же собственное.
      if (!previous.has(slot)) previous.set(slot, await readValue(policy.key, policy.name));

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
    const slot = `${policy.key}\\${policy.name}`;
    const before = previous.get(slot);

    try {
      if (before === undefined || before === null) {
        // До нас значения не было — убираем своё.
        await reg(["delete", policy.key, "/v", policy.name, "/f"]);
      } else {
        // Значение стояло до нас: возвращаем как было, а не стираем.
        await reg(["add", policy.key, "/v", policy.name, "/t", "REG_DWORD", "/d", String(before), "/f"]);
      }
    } catch {
      // Отсутствие значения — обычное дело: снимать нечего.
    }
  }

  previous.clear();

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
