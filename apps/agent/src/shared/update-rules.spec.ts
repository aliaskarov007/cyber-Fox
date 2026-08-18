import { describe, expect, it } from "vitest";

import { canUpdate, skipReason } from "./update-rules.js";

describe("когда агенту можно обновляться", () => {
  it("свободная машина с диском — можно", () => {
    expect(canUpdate({ playing: false, diskless: false })).toBe(true);
    expect(skipReason({ playing: false, diskless: false })).toBeNull();
  });

  it("во время оплаченной игры — нельзя: перезапуск выбьет гостя из катки", () => {
    expect(canUpdate({ playing: true, diskless: false })).toBe(false);
    expect(skipReason({ playing: true, diskless: false })).toContain("сессия");
  });

  it("бездисковой — нельзя даже когда свободна: обновление исчезнет при ребуте", () => {
    expect(canUpdate({ playing: false, diskless: true })).toBe(false);
    expect(skipReason({ playing: false, diskless: true })).toContain("образ");
  });

  it("бездисковость важнее занятости: причина называется она", () => {
    expect(skipReason({ playing: true, diskless: true })).toContain("образ");
  });
});
