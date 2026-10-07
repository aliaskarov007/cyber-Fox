import { describe, expect, it } from "vitest";

import { SHOW_AFTER_START_HOURS, visibleSince } from "./afisha.rules.js";

describe("афиша", () => {
  it("начавшийся турнир ещё виден несколько часов", () => {
    const now = new Date("2026-10-11T20:00:00Z");
    const since = visibleSince(now);
    expect(now.getTime() - since.getTime()).toBe(SHOW_AFTER_START_HOURS * 3_600_000);
    // Турнир начался в 18:00 — в 20:00 он ещё в афише.
    expect(new Date("2026-10-11T18:00:00Z") >= since).toBe(true);
    // Вчерашний — уже нет.
    expect(new Date("2026-10-10T18:00:00Z") >= since).toBe(false);
  });
});
