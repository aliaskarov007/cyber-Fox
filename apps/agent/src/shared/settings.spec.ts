import { describe, expect, it } from "vitest";

import {
  type AgentSettings,
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
  const settings = (over: Partial<AgentSettings> = {}): AgentSettings => ({
    serverUrl: "https://a.kz",
    pairingToken: "",
    enrollmentKey: "",
    ...over,
  });

  it("обычной машине хватает кода привязки", () => {
    expect(isConfigured(settings({ pairingToken: "abc" }))).toBe(true);
  });

  it("бездисковой машине хватает ключа клуба", () => {
    // В общий образ кладут только его: код привязки у каждой машины свой.
    expect(isConfigured(settings({ enrollmentKey: "ключ" }))).toBe(true);
  });

  it("без адреса или способа себя назвать машина не готова", () => {
    expect(isConfigured(settings())).toBe(false);
    expect(isConfigured(settings({ serverUrl: "", pairingToken: "abc" }))).toBe(false);
  });

  it("объясняет, чего не хватает", () => {
    expect(validate(settings({ serverUrl: "", pairingToken: "abc" }))).toBe(
      "Укажите адрес сервера",
    );
    expect(validate(settings())).toBe("Укажите код привязки этой машины или ключ клуба");
    expect(validate(settings({ pairingToken: "abc" }))).toBeNull();
    expect(validate(settings({ enrollmentKey: "ключ" }))).toBeNull();
  });

  it("ловит адрес, который не разбирается в ссылку", () => {
    expect(validate(settings({ serverUrl: "https://", pairingToken: "abc" }))).toBe(
      "Адрес сервера не похож на ссылку",
    );
  });
});
