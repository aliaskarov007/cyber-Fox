import { describe, expect, it } from "vitest";

import { normalizeOrderLines, orderSummary, orderTotal } from "./bar-order.rules.js";

describe("позиции заказа с игрового ПК", () => {
  it("складывает одинаковые товары", () => {
    const result = normalizeOrderLines([
      { productId: "cola", quantity: 1 },
      { productId: "chips", quantity: 2 },
      { productId: "cola", quantity: 2 },
    ]);
    expect(result).toEqual({
      ok: true,
      lines: [
        { productId: "cola", quantity: 3 },
        { productId: "chips", quantity: 2 },
      ],
    });
  });

  it("пустая корзина — отказ", () => {
    expect(normalizeOrderLines([])).toMatchObject({ ok: false });
    expect(normalizeOrderLines(null)).toMatchObject({ ok: false });
  });

  it("дробное, нулевое и отрицательное количество не проходит", () => {
    expect(normalizeOrderLines([{ productId: "a", quantity: 0 }])).toMatchObject({ ok: false });
    expect(normalizeOrderLines([{ productId: "a", quantity: -1 }])).toMatchObject({ ok: false });
    expect(normalizeOrderLines([{ productId: "a", quantity: 1.5 }])).toMatchObject({ ok: false });
  });

  it("предел одной позиции считается после сложения", () => {
    expect(
      normalizeOrderLines([
        { productId: "a", quantity: 15 },
        { productId: "a", quantity: 6 },
      ]),
    ).toMatchObject({ ok: false });
  });
});

describe("сумма и описание заказа", () => {
  const items = [
    { productId: "cola", name: "Кола", quantity: 2, price: 50000 },
    { productId: "chips", name: "Чипсы", quantity: 1, price: 70000 },
  ];

  it("сумма в тиын", () => {
    expect(orderTotal(items)).toBe(170000);
  });

  it("описание для истории счёта", () => {
    expect(orderSummary(items)).toBe("Кола ×2, Чипсы");
  });
});
