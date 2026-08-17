import { describe, expect, it } from "vitest";

import { formatMac, normalizeMac } from "./agent.rules.js";

describe("MAC машины", () => {
  it("приводит любые разделители к одной форме", () => {
    // Ключ, по которому машина находит себя после перезагрузки: расхождение в
    // разделителе завело бы вторую машину вместо найденной первой.
    for (const raw of ["A4:BB:6D:1F:0E:22", "a4-bb-6d-1f-0e-22", "A4BB6D1F0E22", " a4:BB:6d:1F:0e:22 "]) {
      expect(normalizeMac(raw)).toBe("a4:bb:6d:1f:0e:22");
    }
  });

  it("не принимает мусор вместо адреса", () => {
    expect(normalizeMac("")).toBeNull();
    expect(normalizeMac("не-адрес")).toBeNull();
    expect(normalizeMac("a4:bb:6d:1f:0e")).toBeNull();
    expect(normalizeMac("a4:bb:6d:1f:0e:22:33")).toBeNull();
  });

  it("отвергает адрес-заглушку", () => {
    // 00:00:00:00:00:00 отдают виртуальные адаптеры; приняв его, мы свели бы
    // все такие машины в одну.
    expect(normalizeMac("00:00:00:00:00:00")).toBeNull();
  });

  it("показывает адрес так, как он записан в CCBoot", () => {
    expect(formatMac("a4:bb:6d:1f:0e:22")).toBe("A4-BB-6D-1F-0E-22");
  });
});
