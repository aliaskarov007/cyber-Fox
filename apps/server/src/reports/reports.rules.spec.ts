import { describe, expect, it } from "vitest";

import { computeSettlement, fillHours, rankComputers } from "./reports.rules.js";

const kzt = (v: number): number => v * 100;

describe("межклубный взаимозачёт", () => {
  it("зал, где пополнили больше, чем отыграли, должен сети", () => {
    const { rows } = computeSettlement([
      { clubId: "a", clubName: "Центральный", collected: kzt(50_000), consumed: kzt(20_000) },
      { clubId: "b", clubName: "Southern", collected: kzt(10_000), consumed: kzt(40_000) },
    ]);

    const central = rows.find((r) => r.clubId === "a")!;
    const southern = rows.find((r) => r.clubId === "b")!;

    expect(central.balance).toBe(kzt(30_000));
    expect(southern.balance).toBe(kzt(-30_000));
  });

  it("сумма строк показывает изменение денег на кошельках, а не ошибку", () => {
    // Гости внесли 60 000 ₸, отыграли 40 000 ₸: 20 000 ₸ остались на счетах
    // и остаются обязательством сети, а не расхождением учёта.
    const { guestFundsChange } = computeSettlement([
      { clubId: "a", clubName: "A", collected: kzt(50_000), consumed: kzt(20_000) },
      { clubId: "b", clubName: "B", collected: kzt(10_000), consumed: kzt(20_000) },
    ]);

    expect(guestFundsChange).toBe(kzt(20_000));
  });

  it("сходится в ноль только когда за период потратили ровно внесённое", () => {
    const { guestFundsChange } = computeSettlement([
      { clubId: "a", clubName: "A", collected: kzt(50_000), consumed: kzt(20_000) },
      { clubId: "b", clubName: "B", collected: kzt(10_000), consumed: kzt(40_000) },
    ]);

    expect(guestFundsChange).toBe(0);
  });

  it("должники идут первыми — с ними и разбираются", () => {
    const { rows } = computeSettlement([
      { clubId: "a", clubName: "A", collected: kzt(9_000), consumed: kzt(1_000) },
      { clubId: "b", clubName: "B", collected: 0, consumed: kzt(8_000) },
    ]);

    expect(rows[0].clubId).toBe("b");
  });

  it("без общего кошелька расхождения нет", () => {
    const { rows, guestFundsChange } = computeSettlement([
      { clubId: "a", clubName: "A", collected: kzt(5_000), consumed: kzt(5_000) },
    ]);

    expect(rows[0].balance).toBe(0);
    expect(guestFundsChange).toBe(0);
  });
});

describe("прибыльность машин", () => {
  const period = 24 * 60;

  it("считает загрузку долей от периода", () => {
    const [pc] = rankComputers(
      [
        {
          computerId: "c1",
          computerName: "ПК-01",
          zoneName: "Стандарт",
          revenue: kzt(6_000),
          minutes: 720,
          sessions: 4,
        },
      ],
      period,
    );

    expect(pc.occupancy).toBeCloseTo(0.5);
  });

  it("выручка за час занятости не зависит от простоя", () => {
    // Две машины с разной загрузкой, но одинаковым тарифом дают одну ставку в час.
    const [busy, idle] = rankComputers(
      [
        {
          computerId: "c1",
          computerName: "ПК-01",
          zoneName: "Стандарт",
          revenue: kzt(6_000),
          minutes: 600,
          sessions: 5,
        },
        {
          computerId: "c2",
          computerName: "ПК-02",
          zoneName: "Стандарт",
          revenue: kzt(1_200),
          minutes: 120,
          sessions: 1,
        },
      ],
      period,
    );

    expect(busy.revenuePerBusyHour).toBe(idle.revenuePerBusyHour);
  });

  it("простоявшая машина не делит на ноль", () => {
    const [pc] = rankComputers(
      [
        {
          computerId: "c3",
          computerName: "ПК-03",
          zoneName: "Стандарт",
          revenue: 0,
          minutes: 0,
          sessions: 0,
        },
      ],
      period,
    );

    expect(pc.revenuePerBusyHour).toBe(0);
    expect(pc.occupancy).toBe(0);
  });

  it("загрузка не превышает единицу при расхождении данных", () => {
    const [pc] = rankComputers(
      [
        {
          computerId: "c4",
          computerName: "ПК-04",
          zoneName: "Стандарт",
          revenue: kzt(1_000),
          minutes: period * 2,
          sessions: 1,
        },
      ],
      period,
    );

    expect(pc.occupancy).toBe(1);
  });
});

describe("часы пик", () => {
  it("возвращает все 24 часа, включая мёртвые", () => {
    const hours = fillHours([{ hour: 21, revenue: kzt(5_000), sessions: 12 }]);

    expect(hours).toHaveLength(24);
    expect(hours[21].sessions).toBe(12);
    expect(hours[4]).toEqual({ hour: 4, revenue: 0, sessions: 0 });
  });
});
