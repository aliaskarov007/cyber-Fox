import { describe, expect, it } from "vitest";

import {
  type LocalMoment,
  type PackageState,
  type PerMinuteTariffState,
  type SessionBillingState,
  SegmentEndReason,
  canAffordMinute,
  catchUpMinutes,
  creditLeft,
  decideNextMinute,
  isTariffActiveAt,
  minutesAffordable,
  pickNextPackage,
  pickPerMinuteTariff,
} from "./billing.rules.js";

/** 100 ₸ в тиын — кредитный лимит клуба по умолчанию. */
const CREDIT = 10_000;
/** 10 ₸/мин в тиын. */
const PER_MINUTE = 1_000;

const MONDAY_20_00: LocalMoment = {
  minuteOfDay: 20 * 60,
  dayOfWeek: 1,
  at: new Date("2026-03-02T20:00:00Z"),
};

function dayTariff(over: Partial<PerMinuteTariffState> = {}): PerMinuteTariffState {
  return {
    id: "t-day",
    pricePerMinute: PER_MINUTE,
    activeFromMinute: null,
    activeToMinute: null,
    daysOfWeek: [],
    ...over,
  };
}

function pkg(over: Partial<PackageState> = {}): PackageState {
  return {
    id: "p-1",
    zoneId: "z-standard",
    minutesRemaining: 60,
    expiresAt: new Date("2026-04-01T00:00:00Z"),
    ...over,
  };
}

function state(over: Partial<SessionBillingState> = {}): SessionBillingState {
  return {
    zoneId: "z-standard",
    currentSegment: { kind: "PER_MINUTE", tariffId: "t-day", guestPackageId: null },
    packages: [],
    wallet: { balance: 100_000, creditLimit: CREDIT },
    perMinuteTariffs: [dayTariff()],
    ...over,
  };
}

describe("окно действия тарифа", () => {
  it("круглосуточный тариф действует всегда", () => {
    expect(isTariffActiveAt(dayTariff(), MONDAY_20_00)).toBe(true);
  });

  it("ночное окно через полночь действует и до, и после полуночи", () => {
    const night = dayTariff({ activeFromMinute: 22 * 60, activeToMinute: 8 * 60 });
    expect(isTariffActiveAt(night, { ...MONDAY_20_00, minuteOfDay: 23 * 60 })).toBe(true);
    expect(isTariffActiveAt(night, { ...MONDAY_20_00, minuteOfDay: 3 * 60 })).toBe(true);
    expect(isTariffActiveAt(night, { ...MONDAY_20_00, minuteOfDay: 12 * 60 })).toBe(false);
  });

  it("тариф выходного дня не действует в понедельник", () => {
    const weekend = dayTariff({ daysOfWeek: [6, 7] });
    expect(isTariffActiveAt(weekend, MONDAY_20_00)).toBe(false);
  });

  it("тариф с окном перебивает круглосуточный", () => {
    const night = dayTariff({ id: "t-night", activeFromMinute: 18 * 60, activeToMinute: 23 * 60 });
    const picked = pickPerMinuteTariff([dayTariff(), night], MONDAY_20_00);
    expect(picked?.id).toBe("t-night");
  });
});

describe("выбор пакета", () => {
  it("первым тратится тот, что сгорит раньше", () => {
    const late = pkg({ id: "p-late", expiresAt: new Date("2026-05-01T00:00:00Z") });
    const soon = pkg({ id: "p-soon", expiresAt: new Date("2026-03-10T00:00:00Z") });
    expect(pickNextPackage([late, soon], "z-standard", MONDAY_20_00)?.id).toBe("p-soon");
  });

  it("пакет чужой зоны не подходит", () => {
    const vip = pkg({ id: "p-vip", zoneId: "z-vip" });
    expect(pickNextPackage([vip], "z-standard", MONDAY_20_00)).toBeNull();
  });

  it("сгоревший и пустой пакеты не подходят", () => {
    const expired = pkg({ id: "p-exp", expiresAt: new Date("2026-01-01T00:00:00Z") });
    const empty = pkg({ id: "p-empty", minutesRemaining: 0 });
    expect(pickNextPackage([expired, empty], "z-standard", MONDAY_20_00)).toBeNull();
  });
});

describe("кошелёк и кредит", () => {
  it("минуту можно взять в долг, пока не исчерпан лимит", () => {
    expect(canAffordMinute({ balance: 0, creditLimit: CREDIT }, PER_MINUTE)).toBe(true);
    expect(canAffordMinute({ balance: -CREDIT, creditLimit: CREDIT }, PER_MINUTE)).toBe(false);
  });

  it("у анонимной посадки кредита нет", () => {
    expect(canAffordMinute(null, PER_MINUTE)).toBe(false);
    expect(minutesAffordable(null, PER_MINUTE)).toBe(0);
  });

  it("остаток баланса и кредита считается в минутах", () => {
    // 40 ₸ на балансе плюс 100 ₸ кредита при цене 10 ₸/мин — 14 минут.
    expect(minutesAffordable({ balance: 4_000, creditLimit: CREDIT }, PER_MINUTE)).toBe(14);
  });

  it("минута дороже кредита не даёт ни одной минуты долга", () => {
    const vipMinute = 15_000; // 150 ₸/мин при кредите 100 ₸
    expect(canAffordMinute({ balance: 0, creditLimit: CREDIT }, vipMinute)).toBe(false);
  });

  it("остаток кредита уменьшается по мере ухода в минус", () => {
    expect(creditLeft({ balance: 5_000, creditLimit: CREDIT })).toBe(CREDIT);
    expect(creditLeft({ balance: -4_000, creditLimit: CREDIT })).toBe(6_000);
    expect(creditLeft({ balance: -CREDIT, creditLimit: CREDIT })).toBe(0);
  });
});

describe("решение по очередной минуте", () => {
  it("пока есть минуты пакета — деньги не списываются", () => {
    const s = state({
      currentSegment: { kind: "PACKAGE", tariffId: "t-pkg", guestPackageId: "p-1" },
      packages: [pkg()],
    });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({ kind: "PACKAGE_MINUTE", packageId: "p-1" });
  });

  it("пакет исчерпан, но в зоне есть следующий — переходим на него, а не на поминутку", () => {
    const s = state({
      currentSegment: { kind: "PACKAGE", tariffId: "t-pkg", guestPackageId: "p-1" },
      packages: [pkg({ minutesRemaining: 0 }), pkg({ id: "p-2" })],
    });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({
      kind: "SWITCH_PACKAGE",
      packageId: "p-2",
      closeReason: SegmentEndReason.PACKAGE_EXHAUSTED,
    });
  });

  it("минут в зоне не осталось — включается поминутный тариф, сессия продолжается", () => {
    const s = state({
      currentSegment: { kind: "PACKAGE", tariffId: "t-pkg", guestPackageId: "p-1" },
      packages: [pkg({ minutesRemaining: 0 })],
    });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({
      kind: "SWITCH_PER_MINUTE",
      tariffId: "t-day",
      closeReason: SegmentEndReason.PACKAGE_EXHAUSTED,
    });
  });

  it("поминутная минута списывается по цене тарифа", () => {
    expect(decideNextMinute(state(), MONDAY_20_00)).toEqual({
      kind: "PAID_MINUTE",
      tariffId: "t-day",
      amount: PER_MINUTE,
    });
  });

  it("баланс исчерпан — минута берётся в долг", () => {
    const s = state({ wallet: { balance: 0, creditLimit: CREDIT } });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({
      kind: "PAID_MINUTE",
      tariffId: "t-day",
      amount: PER_MINUTE,
    });
  });

  it("кредит исчерпан — сессия останавливается", () => {
    const s = state({ wallet: { balance: -CREDIT, creditLimit: CREDIT } });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({
      kind: "STOP",
      reason: SegmentEndReason.CREDIT_LIMIT,
    });
  });

  it("наступил ночной тариф — отрезок закрывается по расписанию", () => {
    const night = dayTariff({
      id: "t-night",
      pricePerMinute: 500,
      activeFromMinute: 22 * 60,
      activeToMinute: 8 * 60,
    });
    const s = state({ perMinuteTariffs: [dayTariff(), night] });
    const atNight: LocalMoment = { ...MONDAY_20_00, minuteOfDay: 22 * 60 };
    expect(decideNextMinute(s, atNight)).toEqual({
      kind: "SWITCH_PER_MINUTE",
      tariffId: "t-night",
      closeReason: SegmentEndReason.TARIFF_SCHEDULE,
    });
  });

  it("анонимная посадка не уходит в долг", () => {
    const s = state({ wallet: null });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({
      kind: "STOP",
      reason: SegmentEndReason.CREDIT_LIMIT,
    });
  });

  it("пакет, сгоревший посреди игры, доигрывается до конца сессии", () => {
    const s = state({
      currentSegment: { kind: "PACKAGE", tariffId: "t-pkg", guestPackageId: "p-1" },
      packages: [pkg({ expiresAt: new Date("2026-01-01T00:00:00Z") })],
    });
    expect(decideNextMinute(s, MONDAY_20_00)).toEqual({ kind: "PACKAGE_MINUTE", packageId: "p-1" });
  });
});

describe("догон после простоя сервера", () => {
  it("досчитывает пропущенные минуты, когда денег хватает", () => {
    expect(catchUpMinutes(10, { balance: 100_000, creditLimit: CREDIT }, PER_MINUTE)).toBe(10);
  });

  it("не уводит гостя в минус глубже кредита из-за нашей аварии", () => {
    // Час простоя при балансе 0 и кредите 100 ₸ — только 10 минут, а не 60.
    expect(catchUpMinutes(60, { balance: 0, creditLimit: CREDIT }, PER_MINUTE)).toBe(10);
  });
});

describe("сценарий из спецификации целиком", () => {
  it("пакет 3 часа, потом 4 минуты с баланса, потом 10 минут в долг", () => {
    const packages = [pkg({ id: "p-3h", minutesRemaining: 180 })];
    let wallet = { balance: 4_000, creditLimit: CREDIT }; // 40 ₸ после покупки пакета
    let segment: SessionBillingState["currentSegment"] = {
      kind: "PACKAGE",
      tariffId: "t-pkg",
      guestPackageId: "p-3h",
    };

    let packageMinutes = 0;
    let paidMinutes = 0;
    let stopReason: SegmentEndReason | null = null;

    for (let i = 0; i < 500 && stopReason === null; i++) {
      const decision = decideNextMinute(
        { zoneId: "z-standard", currentSegment: segment, packages, wallet, perMinuteTariffs: [dayTariff()] },
        MONDAY_20_00,
      );

      switch (decision.kind) {
        case "PACKAGE_MINUTE": {
          const p = packages.find((x) => x.id === decision.packageId)!;
          p.minutesRemaining -= 1;
          packageMinutes += 1;
          break;
        }
        case "PAID_MINUTE": {
          wallet = { ...wallet, balance: wallet.balance - decision.amount };
          paidMinutes += 1;
          break;
        }
        case "SWITCH_PER_MINUTE":
          segment = { kind: "PER_MINUTE", tariffId: decision.tariffId, guestPackageId: null };
          break;
        case "SWITCH_PACKAGE":
          segment = { kind: "PACKAGE", tariffId: segment.tariffId, guestPackageId: decision.packageId };
          break;
        case "STOP":
          stopReason = decision.reason;
          break;
      }
    }

    expect(packageMinutes).toBe(180);
    expect(paidMinutes).toBe(14); // 4 минуты с баланса плюс 10 в долг
    expect(wallet.balance).toBe(-CREDIT);
    expect(stopReason).toBe(SegmentEndReason.CREDIT_LIMIT);
  });
});
