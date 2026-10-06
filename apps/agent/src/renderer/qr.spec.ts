import { describe, expect, it } from "vitest";

import { encodeQr, qrPath } from "./qr.js";

/*
 * Сам символ проверялся настоящим считывателем (OpenCV) на версиях 1–10 при
 * написании. Здесь — то, что легко сломать правкой: размер, служебные узоры и
 * отказ на слишком длинном тексте.
 */
describe("QR для регистрации", () => {
  it("короткая ссылка WhatsApp укладывается в небольшую версию", () => {
    const matrix = encodeQr("https://wa.me/77001234567?text=Cyber-Fox%204821");
    // Версия 4: 33 модуля — крупные квадраты, камера ловит сразу.
    expect(matrix.length).toBe(33);
    expect(matrix.every((row) => row.length === 33)).toBe(true);
  });

  it("в углах стоят поисковые узоры", () => {
    const m = encodeQr("A");
    const n = m.length;
    for (const [x, y] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      // Внешняя рамка тёмная, следующее кольцо светлое, центр тёмный.
      expect(m[y][x]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
      expect(m[y + 3][x + 3]).toBe(true);
    }
  });

  it("слишком длинный текст не кодирует, а честно отказывает", () => {
    expect(() => encodeQr("x".repeat(300))).toThrow();
  });

  it("рисует с белой каймой", () => {
    const { size } = qrPath(encodeQr("A"));
    expect(size).toBe(21 + 8);
  });
});
