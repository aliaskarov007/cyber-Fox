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

/**
 * Сколько живёт запрет.
 *
 * - `guard` — то, чем снимают самого агента или уходят мимо него: диспетчер
 *   задач, regedit, выход и смена пользователя. Стоит всё время, пока агент
 *   установлен, — и на экране блокировки в первую очередь. Раньше эти запреты
 *   ставились только на время оплаченной игры, и гость без входа открывал
 *   Ctrl+Shift+Esc прямо на экране блокировки, снимал агента и сидел бесплатно.
 *   Агент их не снимает никогда; убирает их только удаление агента.
 * - `session` — то, что мешает только игре: проводник, чужие диски, командная
 *   строка. Ставится на время оплаченной сессии, снимается после.
 */
export type PolicyScope = "guard" | "session";

export interface Policy {
  key: string;
  name: string;
  value: number;
  scope: PolicyScope;
  /** Зачем — чтобы правку было видно не только по имени ключа. */
  why: string;
}

/** Одна политика в каждую из подходящих ей веток. */
function spread(
  keys: string[],
  name: string,
  value: number,
  why: string,
  scope: PolicyScope = "session",
): Policy[] {
  return keys.map((key) => ({ key, name, value, why, scope }));
}

export function policies(): Policy[] {
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
      "guard",
    ),
    /*
     * Диспетчер задач — главный способ убрать блокировку: Ctrl+Alt+Del и
     * Ctrl+Shift+Esc перехватить нельзя ни одной программой, это делает сама
     * система. Значит закрывать его нужно политикой, а не окном, — и до входа
     * гостя, а не после.
     */
    ...spread(SYSTEM_KEYS, "DisableTaskMgr", 1, "закрывает диспетчер задач", "guard"),
    /*
     * Выход из системы и смена пользователя уводят гостя мимо агента: другой
     * сеанс запускается без него, и машина оказывается открытой.
     */
    ...spread(EXPLORER_KEYS, "NoLogoff", 1, "убирает «Выход» и «Сменить пользователя»", "guard"),
    ...spread(SYSTEM_KEYS, "HideFastUserSwitching", 1, "прячет переключение пользователей", "guard"),
    /*
     * Блокировка экрана оставляет сессию идти, а машину — недоступной: время
     * тратится, играть нельзя, администратор ничего не видит.
     */
    ...spread(SYSTEM_KEYS, "DisableLockWorkstation", 1, "убирает блокировку экрана", "guard"),
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
      scope: "session" as const,
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

async function setPolicy(policy: Policy): Promise<void> {
  await reg(["add", policy.key, "/v", policy.name, "/t", "REG_DWORD", "/d", String(policy.value), "/f"]);
}

/**
 * Поставить постоянные запреты: диспетчер задач, regedit, выход и смену
 * пользователя.
 *
 * Вызывается при запуске агента и при каждой блокировке — то есть до того, как
 * гость сел за машину. Запись идемпотентна, повторный вызов ничего не ломает.
 * Проводник не перезапускается: диспетчер задач и экран Ctrl+Alt+Del читают
 * политику в момент открытия, а моргать рабочим столом под экраном блокировки
 * незачем.
 */
export async function applyGuard(): Promise<void> {
  if (!isWindows) return;

  for (const policy of policies().filter((p) => p.scope === "guard")) {
    try {
      await setPolicy(policy);
    } catch (error) {
      console.error(`Защита ${policy.name} (${policy.why}) не применилась: ${text(error)}`);
    }
  }
}

/**
 * Поставить запреты на время игры. Ошибка любой политики не должна ронять
 * сессию: гость уже заплатил, и лучше пустить его играть с открытым проводником,
 * чем не пустить вовсе. Каждая неудача уходит в журнал.
 *
 * Постоянные запреты ставятся заодно: если при запуске агента запись в реестр
 * не прошла, это ещё одна попытка.
 */
export async function applyLockdown(): Promise<void> {
  if (!isWindows) return;

  for (const policy of policies()) {
    const slot = `${policy.key}\\${policy.name}`;
    try {
      // Прежнее значение запоминаем только для того, что потом снимаем, и
      // один раз за сессию: повторный вызов не должен запомнить наше же.
      if (policy.scope === "session" && !previous.has(slot)) {
        previous.set(slot, await readValue(policy.key, policy.name));
      }

      await setPolicy(policy);
    } catch (error) {
      console.error(`Политика ${policy.name} (${policy.why}) не применилась: ${text(error)}`);
    }
  }

  await refreshExplorer();
}

/**
 * Снять запреты игры. Вызывается и при блокировке, и при запуске агента: если
 * прошлая сессия оборвалась падением, машина не должна остаться с закрытым
 * проводником.
 *
 * Постоянные запреты не трогаются: без них экран блокировки снимается
 * диспетчером задач.
 */
export async function releaseLockdown(): Promise<void> {
  if (!isWindows) return;

  for (const policy of policies().filter((p) => p.scope === "session")) {
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

/**
 * Запасной замок на случай, если политика не встала: запись в реестр могла
 * не пройти, а гость успеть открыть диспетчер задач раньше, чем она дошла.
 * Пока агент работает, открытый диспетчер задач закрывается через секунду-две.
 *
 * Диспетчер, запущенный с правами администратора, обычному агенту не по силам —
 * поэтому учётная запись гостя в зале не должна быть администраторской.
 */
let taskManagerTimer: ReturnType<typeof setInterval> | null = null;

export function startTaskManagerGuard(): void {
  if (!isWindows || taskManagerTimer) return;

  taskManagerTimer = setInterval(() => {
    // Ошибку не смотрим: чаще всего она значит «такого процесса нет».
    execFile("taskkill.exe", ["/f", "/im", "Taskmgr.exe"], { windowsHide: true }, () => undefined);
  }, 1500);
}

export function stopTaskManagerGuard(): void {
  if (taskManagerTimer) clearInterval(taskManagerTimer);
  taskManagerTimer = null;
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
