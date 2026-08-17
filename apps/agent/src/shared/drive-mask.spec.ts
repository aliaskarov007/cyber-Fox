import { describe, expect, it } from "vitest";

import { allDrivesExcept, driveMask } from "./drive-mask.js";

describe("маска дисков", () => {
  it("A — младший бит, C — третий", () => {
    expect(driveMask(["A"])).toBe(1);
    expect(driveMask(["C"])).toBe(4);
  });

  it("складывает буквы", () => {
    expect(driveMask(["A", "C"])).toBe(5);
  });

  it("принимает то, что администратор напишет руками: «c:», строчные, пробелы", () => {
    expect(driveMask([" c: "])).toBe(4);
    expect(driveMask(["d"])).toBe(8);
  });

  it("молча пропускает мусор: пустая строка не должна прятать A:", () => {
    expect(driveMask([""])).toBe(0);
    expect(driveMask(["1"])).toBe(0);
  });

  it("прячет всё, кроме указанного", () => {
    const mask = allDrivesExcept(["C"]);
    expect(mask & 4).toBe(0); // C: остаётся видимым
    expect(mask & 8).toBe(8); // D: спрятан
    expect(mask & 1).toBe(1); // A: спрятан
  });

  it("без исключений прячет все двадцать шесть", () => {
    expect(allDrivesExcept([])).toBe((1 << 26) - 1);
  });
});
