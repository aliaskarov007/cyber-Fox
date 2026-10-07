import { describe, expect, it } from "vitest";

import { encodeQr, qrSvgPath } from "./qr.js";

/*
 * Что код действительно читается, проверено декодером OpenCV на всех версиях
 * 1–10 (см. docs/whatsapp.md). Здесь — то, что легко сломать правкой: размер,
 * служебные узоры и предел длины.
 */

function finderAt(m: boolean[][], x: number, y: number): boolean {
  const ring = (dx: number, dy: number) => m[y + dy][x + dx];
  // Чёрная рамка 7×7, белое кольцо, чёрный центр 3×3.
  return ring(0, 0) && ring(6, 6) && !ring(1, 1) && !ring(5, 5) && ring(2, 2) && ring(4, 4);
}

describe("QR-код", () => {
  it("ссылка регистрации укладывается в маленькую версию", () => {
    const m = encodeQr("https://wa.me/77011234567?text=CF-7K2Q");
    // Версия 3 — 29×29: крупные модули, читается с телефона издалека.
    expect(m.length).toBe(29);
    expect(m.every((row) => row.length === 29)).toBe(true);
  });

  it("три поисковых квадрата на месте", () => {
    const m = encodeQr("CF-7K2Q");
    const n = m.length;
    expect(finderAt(m, 0, 0)).toBe(true);
    expect(finderAt(m, n - 7, 0)).toBe(true);
    expect(finderAt(m, 0, n - 7)).toBe(true);
  });

  it("тёмный модуль у левого нижнего квадрата всегда тёмный", () => {
    const m = encodeQr("CF-7K2Q");
    expect(m[m.length - 8][8]).toBe(true);
  });

  it("кириллица кодируется в UTF-8 и не ломает размер", () => {
    expect(encodeQr("Привет, клуб!").length).toBe(25);
  });

  it("слишком длинный текст — понятная ошибка, а не нечитаемый код", () => {
    expect(() => encodeQr("x".repeat(400))).toThrow("Слишком длинный");
  });

  it("SVG включает поля вокруг кода", () => {
    const { size, path } = qrSvgPath(encodeQr("CF"));
    expect(size).toBe(21 + 8);
    expect(path.startsWith("M4,4")).toBe(true);
  });
});
