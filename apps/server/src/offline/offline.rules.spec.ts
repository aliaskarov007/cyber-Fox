import { describe, expect, it } from "vitest";

import { MAX_OFFLINE_MINUTES, isAcceptableMinutes } from "./offline.rules.js";

describe("минуты офлайн-отчёта", () => {
  it("принимает целое в пределах суток", () => {
    for (const minutes of [0, 1, 60, MAX_OFFLINE_MINUTES]) {
      expect(isAcceptableMinutes(minutes)).toBe(true);
    }
  });

  it("отвергает отрицательное: им пытались бы начислить время, а не списать", () => {
    expect(isAcceptableMinutes(-1)).toBe(false);
    expect(isAcceptableMinutes(-1000)).toBe(false);
  });

  it("отвергает дробное: реальный агент шлёт целые минуты", () => {
    expect(isAcceptableMinutes(1.5)).toBe(false);
    expect(isAcceptableMinutes(0.1)).toBe(false);
  });

  it("отвергает больше суток: столько машина за один отчёт не отыграет", () => {
    expect(isAcceptableMinutes(MAX_OFFLINE_MINUTES + 1)).toBe(false);
    expect(isAcceptableMinutes(100_000_000)).toBe(false);
  });

  it("отвергает не-число", () => {
    expect(isAcceptableMinutes(Number.NaN)).toBe(false);
    expect(isAcceptableMinutes(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
