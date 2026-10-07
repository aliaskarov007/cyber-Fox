import { describe, expect, it } from "vitest";

import { eventDay, eventWhen, splitBrand } from "./afisha-format.js";

describe("подписи афиши", () => {
  it("пишет день недели, дату и время начала", () => {
    const start = new Date(2026, 9, 10, 18, 0);
    expect(eventWhen(start, new Date(2026, 9, 7, 3, 0))).toBe("Суббота, 10 октября, с 18:00");
  });

  it("начавшийся ивент называет идущим", () => {
    const start = new Date(2026, 9, 10, 18, 0);
    expect(eventWhen(start, new Date(2026, 9, 10, 19, 0))).toBe("Идёт сейчас");
  });

  it("крупная дата — день и месяц", () => {
    expect(eventDay(new Date(2026, 9, 1, 18, 0))).toBe("01.10");
  });

  it("выделяет дефис в названии сети", () => {
    expect(splitBrand("Cyber-Fox")).toEqual(["Cyber", "-", "Fox"]);
    expect(splitBrand("Арена")).toEqual(["Арена", null, ""]);
  });
});
