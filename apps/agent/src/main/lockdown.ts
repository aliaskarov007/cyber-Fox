import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { allDrivesExcept } from "../shared/drive-mask.js";

const run = promisify(execFile);

/**
 * Что гость не может делать во время оплаченной сессии.
 *
 * Оболочка показывает полки, но Windows под ней никуда не делся: из любого
 * окна открывался проводник, а из него — диски, чужие сохранения и папка с
 * самим агентом. Здесь два набора политик: против побега из-под агента — они
 * держатся всё время, — и на время игры — они снимаются, когда сессия кончилась.
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

/**
 * Запреты против побега из-под агента. Держатся всё время, пока агент
 * работает, — и пока экран заблокирован, и во время игры.
 *
 * Раньше они ставились только на оплаченную сессию, а на заблокированном
 * экране снимались. Ctrl+Alt+Del перехватить не может ни одна программа —
 * его обрабатывает сама Windows, — и гость у запертой машины открывал
 * диспетчер задач, снимал агента и играл бесплатно. Значит закрывать нужно не
 * окном, а политикой, и не на время сессии, а всегда.
 */
function guardPolicies(): Policy[] {
  return [
    ...spread(SYSTEM_KEYS, "DisableTaskMgr", 1, "убирает диспетчер задач, в том числе из Ctrl+Alt+Del"),
    /*
     * Выход из системы и смена пользователя уводят гостя мимо агента: другой
     * сеанс запускается без него, и машина оказывается открытой.
     */
    ...spread(EXPLORER_KEYS, "NoLogoff", 1, "убирает «Выход» из Ctrl+Alt+Del и меню «Пуск»"),
    ...spread(SYSTEM_KEYS, "HideFastUserSwitching", 1, "убирает «Сменить пользователя»"),
    /*
     * Блокировка экрана оставляет сессию идти, а машину — недоступной: время
     * тратится, играть нельзя, администратор ничего не видит.
     */
    ...spread(SYSTEM_KEYS, "DisableLockWorkstation", 1, "убирает «Заблокировать»"),
    ...spread(SYSTEM_KEYS, "DisableChangePassword", 1, "убирает «Изменить пароль»"),
    ...spread(
      SYSTEM_KEYS,
      "DisableRegistryTools",
      1,
      "закрывает regedit, которым снимаются эти же политики",
    ),
  ];
}

/** Запреты на время оплаченной игры: проводник, чужие диски, настройки. */
function sessionPolicies(): Policy[] {
  const hidden = allDrivesExcept(VISIBLE_DRIVES);
  return [
    ...spread(EXPLORER_KEYS, "NoDrives", hidden, "прячет чужие диски в проводнике"),
    ...spread(EXPLORER_KEYS, "NoViewOnDrive", hidden, "закрывает их и по прямому адресу вида E:\\"),
    ...spread(EXPLORER_KEYS, "NoRun", 1, "убирает «Выполнить»"),
    ...spread(EXPLORER_KEYS, "NoFolderOptions", 1, "прячет настройки папок"),
    ...spread(EXPLORER_KEYS, "NoControlPanel", 1, "закрывает панель управления"),
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
 * Что стояло в ключе до нас — отдельно для каждого набора запретов.
 *
 * Нужно, чтобы снятие запретов не выглядело как «удалить всё, что там лежит».
 * Те же самые имена значений использует настоящая групповая политика, и на
 * машине в домене агент стёр бы корпоративные ограничения до следующего входа
 * в систему.
 */
type Remembered = Map<string, number | null>;
const beforeGuard: Remembered = new Map();
const beforeSession: Remembered = new Map();

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
 * Поставить набор запретов. Ошибка любой политики не должна ронять агента:
 * каждая неудача уходит в журнал, остальные ставятся.
 */
async function apply(list: Policy[], previous: Remembered): Promise<void> {
  for (const policy of list) {
    const slot = `${policy.key}\\${policy.name}`;
    try {
      // Запоминаем прежнее значение один раз: повторный вызов не должен
      // запомнить наше же собственное.
      if (!previous.has(slot)) previous.set(slot, await readValue(policy.key, policy.name));

      await reg(["add", policy.key, "/v", policy.name, "/t", "REG_DWORD", "/d", String(policy.value), "/f"]);
    } catch (error) {
      console.error(`Политика ${policy.name} (${policy.why}) не применилась: ${text(error)}`);
    }
  }
}

async function release(list: Policy[], previous: Remembered): Promise<void> {
  for (const policy of list) {
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
}

/**
 * Закрыть пути побега: диспетчер задач, выход, смену пользователя. Ставится
 * при запуске агента и держится до его осознанного закрытия.
 */
export async function applyGuard(): Promise<void> {
  if (!isWindows) return;
  await apply(guardPolicies(), beforeGuard);
  // Ctrl+Alt+Del читает политики сам при каждом нажатии; проводник
  // перезапускаем ради «Выхода» в меню «Пуск».
  await refreshExplorer();
}

/**
 * Вернуть как было. Агент сам этого не делает — запреты против побега держатся
 * и после его закрытия; функция для обслуживания машины руками.
 */
export async function releaseGuard(): Promise<void> {
  if (!isWindows) return;
  await release(guardPolicies(), beforeGuard);
}

/**
 * Поставить запреты на время игры. Ошибка любой политики не должна ронять
 * сессию: гость уже заплатил, и лучше пустить его играть с открытым
 * проводником, чем не пустить вовсе.
 */
export async function applyLockdown(): Promise<void> {
  if (!isWindows) return;
  await apply(sessionPolicies(), beforeSession);
  await refreshExplorer();
}

/**
 * Снять запреты на время игры. Вызывается и при блокировке, и при запуске
 * агента: если прошлая сессия оборвалась падением, проводник не должен
 * остаться закрытым до следующей оплаты. Запреты против побега это не трогает.
 */
export async function releaseLockdown(): Promise<void> {
  if (!isWindows) return;
  await release(sessionPolicies(), beforeSession);
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
