import { describe, expect, it } from "vitest";

import {
  bonusLabel,
  insideWindow,
  isRenewal,
  minutesUntilWindowEnd,
  packageTotalMinutes,
  rolloverMinutes,
  rolloverPercent,
} from "./package.rules.js";

const NIGHT = { from: 22 * 60, to: 8 * 60 };
const SETTINGS = { percent: 20, streakPercent: 30, capPercent: 25, renewBeforeDays: 7, renewAfterDays: 3 };

describe("пакеты «N+M»", () => {
  it("2+1 — три часа за цену двух", () => {
    expect(packageTotalMinutes(120, 60)).toBe(180);
    expect(bonusLabel(120, 60)).toBe("2+1");
    expect(bonusLabel(180, 120)).toBe("3+2");
    expect(bonusLabel(120, 0)).toBeNull();
  });
});

describe("ночной пакет", () => {
  it("окно через полночь", () => {
    expect(insideWindow(23 * 60, NIGHT)).toBe(true);
    expect(insideWindow(3 * 60, NIGHT)).toBe(true);
    expect(insideWindow(8 * 60, NIGHT)).toBe(false);
    expect(insideWindow(15 * 60, NIGHT)).toBe(false);
  });

  it("минуты — ровно до конца ночи", () => {
    expect(minutesUntilWindowEnd(22 * 60, NIGHT)).toBe(600);
    expect(minutesUntilWindowEnd(2 * 60 + 30, NIGHT)).toBe(330);
    expect(minutesUntilWindowEnd(12 * 60, NIGHT)).toBe(0);
  });

  it("дневное окно без перехода через полночь", () => {
    const day = { from: 10 * 60, to: 17 * 60 };
    expect(minutesUntilWindowEnd(16 * 60, day)).toBe(60);
    expect(insideWindow(17 * 60, day)).toBe(false);
  });
});

describe("перенос остатка абонемента", () => {
  const expires = new Date("2026-10-10T12:00:00Z");
  const old = { minutesTotal: 1200, minutesRemaining: 360, carriedMinutes: 0, pricePaid: 1_000_000, expiresAt: expires };
  const next = { paidMinutes: 1200, pricePaid: 1_000_000, streak: 2 };

  it("окно продления: за 7 дней до и 3 дня после", () => {
    const day = 86_400_000;
    expect(isRenewal(old, new Date(expires.getTime() - 8 * day), SETTINGS)).toBe(false);
    expect(isRenewal(old, new Date(expires.getTime() - 7 * day), SETTINGS)).toBe(true);
    expect(isRenewal(old, new Date(expires.getTime() + 3 * day), SETTINGS)).toBe(true);
    expect(isRenewal(old, new Date(expires.getTime() + 4 * day), SETTINGS)).toBe(false);
  });

  it("20% остатка: из 6 часов переезжает 72 минуты", () => {
    expect(rolloverMinutes(old, next, SETTINGS)).toBe(72);
  });

  it("с третьего абонемента подряд — 30%", () => {
    expect(rolloverPercent(3, SETTINGS)).toBe(30);
    expect(rolloverMinutes(old, { ...next, streak: 3 }, SETTINGS)).toBe(108);
  });

  it("не больше 25% от нового абонемента", () => {
    const big = { ...old, minutesTotal: 6000, minutesRemaining: 6000, pricePaid: 5_000_000 };
    expect(rolloverMinutes(big, { paidMinutes: 600, pricePaid: 500_000, streak: 2 }, SETTINGS)).toBe(150);
  });

  it("перенесённое второй раз не едет", () => {
    // Из 1200 минут 200 перенесены с прошлого; осталось 300 — переносится 20% от 300.
    const carried = { ...old, minutesTotal: 1400, carriedMinutes: 200, minutesRemaining: 300 };
    expect(rolloverMinutes(carried, next, SETTINGS)).toBe(60);
    // Осталось больше, чем было своего, — переносится только своё.
    const unused = { ...old, minutesTotal: 1400, carriedMinutes: 200, minutesRemaining: 1400 };
    expect(rolloverMinutes(unused, next, SETTINGS)).toBe(240);
  });

  it("из дешёвой зоны в дорогую — меньше минут", () => {
    // Новый абонемент вдвое дороже за минуту: 72 минуты превращаются в 36.
    expect(rolloverMinutes(old, { paidMinutes: 1200, pricePaid: 2_000_000, streak: 2 }, SETTINGS)).toBe(36);
  });

  it("нечего переносить — ноль", () => {
    expect(rolloverMinutes({ ...old, minutesRemaining: 0 }, next, SETTINGS)).toBe(0);
  });
});

describe("напоминание о продлении", () => {
  const S = { percent: 20, streakPercent: 30, capPercent: 25, renewBeforeDays: 7, renewAfterDays: 3 };
  const now = new Date("2026-10-07T12:00:00Z");
  const pkg = {
    minutesTotal: 1200,
    minutesRemaining: 360,
    carriedMinutes: 0,
    pricePaid: 1_000_000,
    expiresAt: new Date("2026-10-10T12:00:00Z"),
    streak: 1,
  };
  const tariff = { packageMinutes: 1200, packagePrice: 1_000_000 };

  it("за несколько дней до конца — говорит, сколько перенесём", async () => {
    const { renewalHint } = await import("./package.rules.js");
    expect(renewalHint(pkg, tariff, S, now, { day: 10, month: 10 })).toBe(
      "Абонемент заканчивается 10 октября, осталось 6 ч. Продлите у администратора — перенесём 1 ч 12 мин в новый.",
    );
  });

  it("рано — молчит", async () => {
    const { renewalHint } = await import("./package.rules.js");
    const early = { ...pkg, expiresAt: new Date("2026-10-30T12:00:00Z") };
    expect(renewalHint(early, tariff, S, now, { day: 30, month: 10 })).toBeNull();
  });
});
