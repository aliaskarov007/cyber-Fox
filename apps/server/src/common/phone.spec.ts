import { describe, expect, it } from "vitest";

import { normalizePhone, phoneTail } from "./phone.js";

describe("номер телефона", () => {
  it("приводит все привычные записи казахстанского номера к одной", () => {
    for (const raw of [
      "+77011234567",
      "+7 701 123 45 67",
      "8 701 123 45 67",
      "87011234567",
      "77011234567",
      "7011234567",
      "+7 (701) 123-45-67",
    ]) {
      expect(normalizePhone(raw)).toBe("+77011234567");
    }
  });

  it("номер другой страны оставляет с его кодом", () => {
    expect(normalizePhone("+998 90 123 45 67")).toBe("+998901234567");
  });

  it("обрывок номера не принимает", () => {
    expect(normalizePhone("70112")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("хвост номера — четыре последние цифры", () => {
    expect(phoneTail("+77011234567")).toBe("4567");
  });
});
