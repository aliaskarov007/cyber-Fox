import { describe, expect, it } from "vitest";

import { sendBlocker, summarizeInvites } from "./events.rules.js";

describe("сводка приглашений", () => {
  it("раскладывает статусы и считает итог", () => {
    const summary = summarizeInvites([
      { status: "SENT", count: 40 },
      { status: "GOING", count: 12 },
      { status: "DECLINED", count: 3 },
      { status: "FAILED", count: 2 },
      { status: "PENDING", count: 5 },
    ]);

    expect(summary).toEqual({ total: 62, pending: 5, sent: 40, failed: 2, going: 12, declined: 3 });
  });

  it("пустой ивент — нули, а не пропуски", () => {
    expect(summarizeInvites([]).total).toBe(0);
  });
});

describe("можно ли рассылать", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("будущий ивент — можно", () => {
    expect(sendBlocker({ startsAt: new Date("2026-10-10T15:00:00Z"), canceledAt: null }, now)).toBeNull();
  });

  it("отменённый — нельзя", () => {
    expect(sendBlocker({ startsAt: new Date("2026-10-10T15:00:00Z"), canceledAt: now }, now)).toBe(
      "Ивент отменён",
    );
  });

  it("начавшийся — поздно", () => {
    expect(sendBlocker({ startsAt: now, canceledAt: null }, now)).toContain("начался");
  });
});
