import { describe, expect, it } from "vitest";

import { maskPhone } from "./whatsapp.monitor.js";

describe("номер в экране подключения", () => {
  it("виден не целиком", () => {
    expect(maskPhone("77011234567")).toBe("+7 701 ••• •• 67");
  });
});
