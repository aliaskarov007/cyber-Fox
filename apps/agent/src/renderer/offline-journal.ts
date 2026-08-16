/**
 * Локальный журнал агента: то, что позволяет залу доиграть без интернета.
 *
 * Ключевое правило — длительность считается по **монотонным** часам, а не по
 * системному времени: перевод часов на игровом ПК не должен превращаться
 * в бесплатные часы (docs/offline.md, раздел 5).
 *
 * Логика вынесена отдельно от интерфейса, чтобы проверяться тестами: ошибка
 * здесь означает либо потерянные деньги клуба, либо лишние списания с гостя.
 */

export interface SessionSnapshot {
  sessionId: string;
  /** Остаток минут пакета; пусто — идёт поминутный отрезок. */
  packageMinutesLeft: number | null;
  /** На сколько минут хватит баланса при поминутной оплате. */
  minutesAffordable: number | null;
  balance: number;
  accruedCost: number;
  /** Монотонная метка момента, когда снимок получен от сервера. */
  receivedAtMonotonic: number;
}

/**
 * Отчёт агента о работе без связи.
 *
 * Это не команда списать деньги: сервер сам досчитывает пропущенные минуты по
 * сроку, сохранённому в базе. Отчёт нужен обратному — сообщить, сколько машина
 * реально играла, чтобы сервер вернул начисленное сверх того.
 */
export interface OfflineOperation {
  uuid: string;
  sequence: number;
  kind: "session.offline_report";
  sessionId: string;
  /** Сколько минут машина действительно играла без связи. */
  minutes: number;
  /** Оплаченное время кончилось локально, экран заблокирован. */
  endedLocally: boolean;
  deviceTime: string;
  /** Последний тик от сервера — граница периода без связи. */
  lastKnownServerTime: string | null;
}

export interface JournalState {
  snapshot: SessionSnapshot | null;
  /** Минуты, отыгранные локально и ещё не отчитанные серверу. */
  offlineMinutes: number;
  /** Оплаченное время кончилось, пока связи не было. */
  endedLocally: boolean;
  queue: OfflineOperation[];
  nextSequence: number;
  lastKnownServerTime: string | null;
}

export function emptyJournal(): JournalState {
  return {
    snapshot: null,
    offlineMinutes: 0,
    endedLocally: false,
    queue: [],
    nextSequence: 1,
    lastKnownServerTime: null,
  };
}

/**
 * Снимок от сервера. Сервер — источник правды: его данные затирают локальные
 * оценки, а счётчик офлайн-минут обнуляется, потому что они уже учтены.
 */
export function applyServerTick(
  state: JournalState,
  snapshot: Omit<SessionSnapshot, "receivedAtMonotonic">,
  monotonicNow: number,
  serverTime: string,
): JournalState {
  return {
    ...state,
    snapshot: { ...snapshot, receivedAtMonotonic: monotonicNow },
    offlineMinutes: 0,
    endedLocally: false,
    lastKnownServerTime: serverTime,
  };
}

/** Сколько минут осталось по последнему снимку с учётом отыгранного офлайн. */
export function minutesLeft(state: JournalState): number {
  if (!state.snapshot) return 0;
  const base =
    state.snapshot.packageMinutesLeft ?? state.snapshot.minutesAffordable ?? 0;
  return Math.max(0, base - state.offlineMinutes);
}

export interface LocalTickResult {
  state: JournalState;
  /** Оплаченное время кончилось — экран пора блокировать. */
  exhausted: boolean;
}

/**
 * Локальный ход времени без связи с сервером.
 *
 * Считает целые минуты, прошедшие по монотонным часам с момента последнего
 * снимка, и останавливается, когда оплаченное время кончилось: без сервера
 * решить, дать ли в долг, нельзя, а долг начислять некому.
 */
export function tickOffline(state: JournalState, monotonicNow: number): LocalTickResult {
  if (!state.snapshot) return { state, exhausted: false };

  const elapsed = Math.floor((monotonicNow - state.snapshot.receivedAtMonotonic) / 60_000);
  if (elapsed <= state.offlineMinutes) return { state, exhausted: minutesLeft(state) <= 0 };

  const base = state.snapshot.packageMinutesLeft ?? state.snapshot.minutesAffordable ?? 0;
  // Больше оплаченного локально не насчитываем: остальное решит сервер.
  const minutes = Math.min(elapsed, base);

  const exhausted = minutes >= base;
  return {
    state: { ...state, offlineMinutes: minutes, endedLocally: state.endedLocally || exhausted },
    exhausted,
  };
}

/**
 * Закрывает наблюдения за период без связи в операцию очереди.
 *
 * Вызывается при восстановлении связи. UUID генерируется здесь и остаётся
 * неизменным при повторных отправках — это и есть ключ идемпотентности.
 */
export function sealOfflineMinutes(
  state: JournalState,
  deviceTime: string,
  makeUuid: () => string,
): JournalState {
  if (!state.snapshot) return state;
  // Отчёт нужен и при нуле минут: он означает, что машина не играла вовсе,
  // и сервер должен вернуть всё, что успел начислить за это время.
  if (state.offlineMinutes <= 0 && !state.endedLocally) return state;

  const operation: OfflineOperation = {
    uuid: makeUuid(),
    sequence: state.nextSequence,
    kind: "session.offline_report",
    sessionId: state.snapshot.sessionId,
    minutes: state.offlineMinutes,
    endedLocally: state.endedLocally,
    deviceTime,
    lastKnownServerTime: state.lastKnownServerTime,
  };

  return {
    ...state,
    queue: [...state.queue, operation],
    offlineMinutes: 0,
    endedLocally: false,
    nextSequence: state.nextSequence + 1,
  };
}

/**
 * Убирает подтверждённые операции. Пока сервер не ответил, очередь не чистится:
 * обрыв во время отправки не должен потерять минуты — повторная доставка
 * безопасна благодаря UUID.
 */
export function acknowledge(state: JournalState, uuids: string[]): JournalState {
  const confirmed = new Set(uuids);
  return { ...state, queue: state.queue.filter((op) => !confirmed.has(op.uuid)) };
}
