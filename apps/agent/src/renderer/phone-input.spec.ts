import { describe, expect, it } from "vitest";

import { addDigit, formatNational, fullPhone } from "./phone-input.js";

describe("набор номера", () => {
  it("пропускает привычную восьмёрку в начале", () => {
    let d = "";
    for (const c of "87011234567") d = addDigit(d, c);
    expect(d).toBe("7011234567");
    expect(fullPhone(d)).toBe("+77011234567");
  });

  it("восьмёрку внутри номера оставляет", () => {
    expect(addDigit("70", "8")).toBe("708");
  });

  it("лишние цифры не принимает", () => {
    expect(addDigit("7011234567", "9")).toBe("7011234567");
  });

  it("показывает номер с прочерками по мере набора", () => {
    expect(formatNational("701")).toBe("+7 (701) ___-__-__");
    expect(formatNational("7011234567")).toBe("+7 (701) 123-45-67");
  });
});
