import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { extractCode, isStop, newCode, parseIncoming, signatureValid, waLink } from "./whatsapp.rules.js";

describe("подтверждение через WhatsApp", () => {
  it("код — четыре цифры без ведущего нуля", () => {
    for (let i = 0; i < 200; i += 1) expect(newCode()).toMatch(/^[1-9]\d{3}$/);
  });

  it("ссылка открывает чат клуба с готовым текстом", () => {
    const link = waLink("+7 700 123 45 67", "4821");
    expect(link.startsWith("https://wa.me/77001234567?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toContain("4821");
  });

  it("находит код в тексте, даже если гость дописал своё", () => {
    expect(extractCode("Код подтверждения 4821")).toBe("4821");
    expect(extractCode("привет 4821 это я")).toBe("4821");
    expect(extractCode("48211")).toBeNull();
    expect(extractCode("без кода")).toBeNull();
  });

  it("понимает отписку", () => {
    expect(isStop("СТОП")).toBe(true);
    expect(isStop(" stop ")).toBe(true);
    expect(isStop("стоп!")).toBe(true);
    expect(isStop("не стоп, а код 4821")).toBe(false);
  });

  it("достаёт из вебхука только текстовые сообщения", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "77011234567", type: "text", text: { body: "Код подтверждения 4821" } },
                  { from: "77011234567", type: "image", image: {} },
                ],
                statuses: [{ id: "x" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseIncoming(payload)).toEqual([{ from: "77011234567", text: "Код подтверждения 4821" }]);
    expect(parseIncoming(null)).toEqual([]);
    expect(parseIncoming({ entry: "мусор" })).toEqual([]);
  });

  it("принимает только запрос, подписанный ключом приложения", () => {
    const body = '{"entry":[]}';
    const good = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(signatureValid(body, good, "secret")).toBe(true);
    expect(signatureValid(body, good, "other")).toBe(false);
    expect(signatureValid(`${body} `, good, "secret")).toBe(false);
    expect(signatureValid(body, undefined, "secret")).toBe(false);
    expect(signatureValid(body, "sha256=abc", "secret")).toBe(false);
  });
});
