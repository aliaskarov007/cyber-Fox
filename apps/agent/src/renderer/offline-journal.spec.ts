import { describe, expect, it } from "vitest";

import {
  type JournalState,
  acknowledge,
  applyServerTick,
  emptyJournal,
  minutesLeft,
  sealOfflineMinutes,
  tickOffline,
} from "./offline-journal.js";

const MINUTE = 60_000;
const SERVER_TIME = "2026-03-02T20:00:00.000Z";

function withSession(over: Partial<JournalState["snapshot"]> = {}): JournalState {
  return applyServerTick(
    emptyJournal(),
    {
      sessionId: "s-1",
      packageMinutesLeft: null,
      minutesAffordable: 30,
      balance: 30_000,
      accruedCost: 0,
      ...over,
    },
    0,
    SERVER_TIME,
  );
}

describe("локальный ход времени", () => {
  it("не тратит минуты, пока минута не прошла целиком", () => {
    const { state } = tickOffline(withSession(), 59_000);
    expect(state.offlineMinutes).toBe(0);
    expect(minutesLeft(state)).toBe(30);
  });

  it("считает целые минуты по монотонным часам", () => {
    const { state } = tickOffline(withSession(), 5 * MINUTE + 30_000);
    expect(state.offlineMinutes).toBe(5);
    expect(minutesLeft(state)).toBe(25);
  });

  it("тратит минуты пакета, когда идёт пакетный отрезок", () => {
    const session = withSession({ packageMinutesLeft: 12, minutesAffordable: 999 });
    const { state } = tickOffline(session, 3 * MINUTE);
    expect(minutesLeft(state)).toBe(9);
  });

  it("останавливается на исчерпании оплаченного, а не уходит в долг", () => {
    // Без сервера решить, давать ли кредит, нельзя: начислять долг некому.
    const { state, exhausted } = tickOffline(withSession({ minutesAffordable: 4 }), 10 * MINUTE);
    expect(state.offlineMinutes).toBe(4);
    expect(exhausted).toBe(true);
    expect(minutesLeft(state)).toBe(0);
  });

  it("перевод системных часов назад не добавляет времени", () => {
    // Монотонные часы не идут назад, поэтому отрицательная разница даёт ноль.
    const { state } = tickOffline(withSession(), -3 * MINUTE);
    expect(state.offlineMinutes).toBe(0);
  });
});

describe("снимок от сервера", () => {
  it("затирает локальную оценку и обнуляет офлайн-минуты", () => {
    const offline = tickOffline(withSession(), 5 * MINUTE).state;
    expect(offline.offlineMinutes).toBe(5);

    const synced = applyServerTick(
      offline,
      {
        sessionId: "s-1",
        packageMinutesLeft: null,
        minutesAffordable: 25,
        balance: 25_000,
        accruedCost: 5_000,
      },
      5 * MINUTE,
      "2026-03-02T20:05:00.000Z",
    );

    expect(synced.offlineMinutes).toBe(0);
    expect(minutesLeft(synced)).toBe(25);
  });
});

describe("отчёт о работе без связи", () => {
  it("сообщает, сколько машина реально играла", () => {
    const offline = tickOffline(withSession(), 7 * MINUTE).state;
    const sealed = sealOfflineMinutes(offline, "2026-03-02T20:07:00.000Z", () => "uuid-1");

    expect(sealed.queue).toHaveLength(1);
    expect(sealed.queue[0]).toMatchObject({
      uuid: "uuid-1",
      sequence: 1,
      sessionId: "s-1",
      minutes: 7,
      endedLocally: false,
      lastKnownServerTime: SERVER_TIME,
    });
    expect(sealed.offlineMinutes).toBe(0);
  });

  it("сообщает о локальной блокировке: сервер закроет сессию", () => {
    const offline = tickOffline(withSession({ minutesAffordable: 3 }), 20 * MINUTE).state;
    const sealed = sealOfflineMinutes(offline, "2026-03-02T20:20:00.000Z", () => "uuid-1");

    expect(sealed.queue[0]).toMatchObject({ minutes: 3, endedLocally: true });
  });

  it("без обрыва отчитываться не о чем", () => {
    const sealed = sealOfflineMinutes(withSession(), "2026-03-02T20:00:00.000Z", () => "uuid-x");
    expect(sealed.queue).toHaveLength(0);
  });

  it("порядковые номера растут: сервер восстановит очерёдность", () => {
    let state = tickOffline(withSession(), 2 * MINUTE).state;
    state = sealOfflineMinutes(state, SERVER_TIME, () => "uuid-1");
    state = applyServerTick(
      state,
      { sessionId: "s-1", packageMinutesLeft: null, minutesAffordable: 20, balance: 0, accruedCost: 0 },
      2 * MINUTE,
      SERVER_TIME,
    );
    state = tickOffline(state, 5 * MINUTE).state;
    state = sealOfflineMinutes(state, SERVER_TIME, () => "uuid-2");

    expect(state.queue.map((op) => op.sequence)).toEqual([1, 2]);
  });

  it("очередь чистится только после подтверждения сервером", () => {
    let state = tickOffline(withSession(), 3 * MINUTE).state;
    state = sealOfflineMinutes(state, SERVER_TIME, () => "uuid-1");

    // Обрыв во время отправки: подтверждения нет, операция остаётся.
    expect(acknowledge(state, []).queue).toHaveLength(1);
    expect(acknowledge(state, ["uuid-1"]).queue).toHaveLength(0);
  });
});
