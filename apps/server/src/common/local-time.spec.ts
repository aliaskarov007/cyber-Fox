import { describe, expect, it } from "vitest";

import { toLocalMoment } from "./local-time.js";

describe("приведение к часовому поясу клуба", () => {
  it("считает минуту суток по местному времени зала", () => {
    // 17:00 UTC — это 22:00 в Алматы, то есть час начала ночного тарифа.
    const moment = toLocalMoment(new Date("2026-03-02T17:00:00Z"), "Asia/Almaty");
    expect(moment.minuteOfDay).toBe(22 * 60);
  });

  it("полночь считается нулевой минутой, а не 1440-й", () => {
    const moment = toLocalMoment(new Date("2026-03-02T19:00:00Z"), "Asia/Almaty");
    expect(moment.minuteOfDay).toBe(0);
  });

  it("день недели переходит на следующий вместе с местной полуночью", () => {
    // Понедельник 19:00 UTC — уже вторник в Алматы.
    const moment = toLocalMoment(new Date("2026-03-02T19:00:00Z"), "Asia/Almaty");
    expect(moment.dayOfWeek).toBe(2);
  });
});
