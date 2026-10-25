import { describe, expect, it } from "vitest";

import {
  Discrepancy,
  bonusFor,
  computeShiftTotals,
  reconcile,
  tournamentNet,
} from "./shift.rules.js";

/** ₸ → тиын. */
const kzt = (v: number): number => v * 100;

describe("сверка кассы", () => {
  it("ожидаемая наличность складывается из размена и всего принятого наличными", () => {
    const totals = computeShiftTotals({
      cash: {
        openingFloat: kzt(5_000),
        topUpsCash: kzt(12_000),
        packagesCash: kzt(3_000),
        productsCash: kzt(2_400),
      },
      cardTotal: kzt(8_000),
      balanceTotal: kzt(4_500),
      sessionsRevenue: kzt(19_000),
      productsRevenue: kzt(6_400),
    });

    expect(totals.cashExpected).toBe(kzt(22_400));
  });

  it("выручка смены не равна наличным в кассе", () => {
    // Гость пополнил счёт вчера, а отыграл сегодня: деньги в кассе прошлой смены.
    const totals = computeShiftTotals({
      cash: { openingFloat: 0, topUpsCash: 0, packagesCash: 0, productsCash: 0 },
      cardTotal: 0,
      balanceTotal: kzt(3_000),
      sessionsRevenue: kzt(3_000),
      productsRevenue: 0,
    });

    expect(totals.cashExpected).toBe(0);
    expect(totals.revenue).toBe(kzt(3_000));
  });

  it("совпадение кассы", () => {
    expect(reconcile(kzt(22_400), kzt(22_400))).toEqual({
      expected: kzt(22_400),
      counted: kzt(22_400),
      difference: 0,
      status: Discrepancy.MATCH,
    });
  });

  it("недостача фиксируется отрицательной разницей", () => {
    const result = reconcile(kzt(22_400), kzt(21_900));
    expect(result.difference).toBe(kzt(-500));
    expect(result.status).toBe(Discrepancy.SHORTAGE);
  });

  it("излишек тоже расхождение, а не удача", () => {
    const result = reconcile(kzt(22_400), kzt(22_600));
    expect(result.difference).toBe(kzt(200));
    expect(result.status).toBe(Discrepancy.SURPLUS);
  });
});

describe("бонусы", () => {
  it("начисляются процентом от потраченного", () => {
    expect(bonusFor(kzt(1_000), 5)).toBe(kzt(50));
  });

  it("выключены при нулевом проценте", () => {
    expect(bonusFor(kzt(1_000), 0)).toBe(0);
  });

  it("не начисляются на возврат", () => {
    expect(bonusFor(kzt(-500), 5)).toBe(0);
  });

  it("округляются вниз, чтобы клуб не дарил лишнего", () => {
    expect(bonusFor(999, 5)).toBe(49);
  });
});

describe("турнирные деньги", () => {
  it("взносы минус призы и возвраты", () => {
    // Восемь взносов по 1000 ₸, два возврата, приз 5 900 ₸.
    const net = tournamentNet([
      ...Array.from({ length: 8 }, () => ({ amount: -100_000 })),
      { amount: 100_000 },
      { amount: 100_000 },
      { amount: 590_000 },
    ]);
    expect(net).toBe(10_000);
  });

  it("уходит в минус, когда клуб добавил в фонд больше, чем собрал", () => {
    // Два взноса по 1000 ₸, фонд 12 000 ₸ — клуб потратил свои.
    expect(tournamentNet([{ amount: -100_000 }, { amount: -100_000 }, { amount: 1_200_000 }])).toBe(
      -1_000_000,
    );
  });

  it("без турниров не меняет выручку", () => {
    expect(tournamentNet([])).toBe(0);
  });

  it("входит в выручку смены", () => {
    const totals = computeShiftTotals({
      cash: { openingFloat: 0, topUpsCash: 0, packagesCash: 0, productsCash: 0 },
      cardTotal: 0,
      balanceTotal: 0,
      sessionsRevenue: 500_000,
      productsRevenue: 100_000,
      tournamentNet: -200_000,
    });
    // Турнир, стоивший клубу денег, уменьшает выручку смены — иначе отчёт
    // показывал бы заработок там, где был расход.
    expect(totals.revenue).toBe(400_000);
  });
});
