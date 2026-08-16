import { describe, expect, it } from "vitest";

import { groupSessionCharges } from "./guests.service.js";

const sessions = [{ id: "s-1", computer: { name: "ПК-14" } }];

function charge(id: string, at: string, balanceAfter: number) {
  return {
    id,
    type: "SESSION_CHARGE",
    amount: -500,
    balanceAfter,
    comment: null,
    createdAt: new Date(at),
    sessionId: "s-1",
  };
}

describe("история счёта гостя", () => {
  it("схлопывает поминутные списания одного визита в одну строку", () => {
    const entries = groupSessionCharges(
      [
        charge("t-3", "2026-03-02T20:03:00Z", 8_500),
        charge("t-2", "2026-03-02T20:02:00Z", 9_000),
        charge("t-1", "2026-03-02T20:01:00Z", 9_500),
      ],
      sessions,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(-1_500);
    expect(entries[0].minutes).toBe(3);
    expect(entries[0].comment).toBe("ПК-14");
  });

  it("баланс визита берётся по самому раннему списанию", () => {
    const entries = groupSessionCharges(
      [
        charge("t-2", "2026-03-02T20:02:00Z", 9_000),
        charge("t-1", "2026-03-02T20:01:00Z", 9_500),
      ],
      sessions,
    );

    expect(entries[0].balanceAfter).toBe(9_500);
  });

  it("разные визиты не смешиваются", () => {
    const other = { ...charge("t-9", "2026-03-03T10:00:00Z", 5_000), sessionId: "s-2" };
    const entries = groupSessionCharges([other, charge("t-1", "2026-03-02T20:01:00Z", 9_500)], [
      ...sessions,
      { id: "s-2", computer: { name: "VIP-01" } },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.comment)).toEqual(["VIP-01", "ПК-14"]);
  });

  it("пополнения и покупки остаются отдельными строками", () => {
    const topUp = {
      id: "t-top",
      type: "TOPUP",
      amount: 300_000,
      balanceAfter: 300_000,
      comment: null,
      createdAt: new Date("2026-03-02T19:00:00Z"),
      sessionId: null,
    };

    const entries = groupSessionCharges([topUp, charge("t-1", "2026-03-02T20:01:00Z", 9_500)], sessions);

    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("TOPUP");
    expect(entries[0].minutes).toBeNull();
  });
});
