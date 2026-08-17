import { describe, expect, it } from "vitest";

import {
  isConfigured,
  normalizePairingToken,
  normalizeServerUrl,
  validate,
} from "./settings.js";

describe("адрес сервера", () => {
  it("дописывает https, когда схему не набрали", () => {
    // Админ печатает адрес с листка и схему обычно опускает.
    expect(normalizeServerUrl("club.cyberfox.kz")).toBe("https://club.cyberfox.kz");
  });

  it("не понижает до http молча", () => {
    // Тихий откат на http означал бы код привязки открытым текстом.
    expect(normalizeServerUrl("cyberfox.kz")).toMatch(/^https:/);
  });

  it("для сервера в локальной сети подставляет http", () => {
    // На 192.168.* сертификат не выдаётся: https там не соединится вовсе, а
    // причину администратор будет искать в сети.
    expect(normalizeServerUrl("192.168.1.50:8080")).toBe("http://192.168.1.50:8080");
    expect(normalizeServerUrl("10.0.0.5:8080")).toBe("http://10.0.0.5:8080");
    expect(normalizeServerUrl("172.20.1.1")).toBe("http://172.20.1.1");
    expect(normalizeServerUrl("localhost:3000")).toBe("http://localhost:3000");
  });

  it("внешний IP локальным не считает", () => {
    expect(normalizeServerUrl("172.15.0.1")).toMatch(/^https:/);
    expect(normalizeServerUrl("8.8.8.8")).toMatch(/^https:/);
  });

  it("оставляет явно указанную схему", () => {
    expect(normalizeServerUrl("http://192.168.1.10:3000")).toBe("http://192.168.1.10:3000");
  });

  it("убирает хвостовой слэш и пробелы", () => {
    expect(normalizeServerUrl("  https://club.cyberfox.kz//  ")).toBe("https://club.cyberfox.kz");
  });

  it("пустая строка остаётся пустой", () => {
    expect(normalizeServerUrl("   ")).toBe("");
  });
});

describe("код привязки", () => {
  it("терпит пробелы и регистр", () => {
    expect(normalizePairingToken("  4F3A 9C2B  ")).toBe("4f3a9c2b");
  });
});

describe("готовность к работе", () => {
  it("настроенной машиной считается только полностью заполненная", () => {
    expect(isConfigured({ serverUrl: "https://a.kz", pairingToken: "abc" })).toBe(true);
    expect(isConfigured({ serverUrl: "https://a.kz", pairingToken: "" })).toBe(false);
    expect(isConfigured({ serverUrl: "", pairingToken: "abc" })).toBe(false);
  });

  it("объясняет, чего не хватает", () => {
    expect(validate({ serverUrl: "", pairingToken: "abc" })).toBe("Укажите адрес сервера");
    expect(validate({ serverUrl: "https://a.kz", pairingToken: "" })).toBe(
      "Укажите код привязки этой машины",
    );
    expect(validate({ serverUrl: "https://a.kz", pairingToken: "abc" })).toBeNull();
  });

  it("ловит адрес, который не разбирается в ссылку", () => {
    expect(validate({ serverUrl: "https://", pairingToken: "abc" })).toBe(
      "Адрес сервера не похож на ссылку",
    );
  });
});
