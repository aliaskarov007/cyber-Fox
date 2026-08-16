import { describe, expect, it } from "vitest";

import {
  AccessLevel,
  type SubscriptionState,
  SubscriptionPlan,
  SubscriptionStatus,
  canAddComputer,
  evaluateAccess,
  invoiceAmount,
} from "./subscription.rules.js";

const NOW = new Date("2026-03-02T12:00:00Z");
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

function state(over: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    plan: SubscriptionPlan.BASIC,
    status: SubscriptionStatus.ACTIVE,
    maxComputers: 60,
    trialEndsAt: null,
    currentPeriodEnd: inDays(20),
    graceEndsAt: null,
    ...over,
  };
}

describe("доступ к платформе", () => {
  it("оплаченная подписка работает без предупреждений", () => {
    expect(evaluateAccess(state(), NOW)).toEqual({
      level: AccessLevel.FULL,
      message: null,
      daysLeft: 20,
    });
  });

  it("за три дня до продления предупреждает", () => {
    const decision = evaluateAccess(state({ currentPeriodEnd: inDays(2) }), NOW);
    expect(decision.level).toBe(AccessLevel.WARNING);
    expect(decision.message).toContain("2 дн");
  });

  it("пробный период идёт молча, пока далеко до конца", () => {
    const decision = evaluateAccess(
      state({ status: SubscriptionStatus.TRIALING, trialEndsAt: inDays(10) }),
      NOW,
    );
    expect(decision.level).toBe(AccessLevel.FULL);
  });

  it("пробный период на исходе — предупреждение, но зал работает", () => {
    const decision = evaluateAccess(
      state({ status: SubscriptionStatus.TRIALING, trialEndsAt: inDays(2) }),
      NOW,
    );
    expect(decision.level).toBe(AccessLevel.WARNING);
  });

  it("пробный период кончился — новые сессии не запускаются", () => {
    const decision = evaluateAccess(
      state({ status: SubscriptionStatus.TRIALING, trialEndsAt: inDays(-1) }),
      NOW,
    );
    expect(decision.level).toBe(AccessLevel.READ_ONLY);
  });

  it("просрочка не гасит зал сразу: сначала льготный период", () => {
    // Зал живёт сменами по 12 часов; остановка посреди смены из-за платежа —
    // потерянная выручка, а не рычаг давления.
    const decision = evaluateAccess(
      state({ status: SubscriptionStatus.PAST_DUE, graceEndsAt: inDays(5) }),
      NOW,
    );
    expect(decision.level).toBe(AccessLevel.WARNING);
    expect(decision.message).toContain("5 дн");
  });

  it("льготный период кончился — запрет на новые сессии", () => {
    const decision = evaluateAccess(
      state({ status: SubscriptionStatus.PAST_DUE, graceEndsAt: inDays(-1) }),
      NOW,
    );
    expect(decision.level).toBe(AccessLevel.READ_ONLY);
  });

  it("отменённая подписка оставляет доступ к данным", () => {
    const decision = evaluateAccess(state({ status: SubscriptionStatus.CANCELED }), NOW);
    expect(decision.level).toBe(AccessLevel.READ_ONLY);
    expect(decision.message).toContain("выгрузки");
  });
});

describe("лимит машин", () => {
  it("до лимита машины добавляются", () => {
    expect(canAddComputer(state({ maxComputers: 60 }), 59).allowed).toBe(true);
  });

  it("на лимите просит перейти на тариф побольше", () => {
    const result = canAddComputer(state({ maxComputers: 60 }), 60);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("60 машин");
  });
});

describe("сумма счёта", () => {
  it("считается по числу подключённых машин", () => {
    // 40 машин × 300 ₸ = 12 000 ₸.
    expect(invoiceAmount(SubscriptionPlan.BASIC, 40)).toBe(1_200_000);
  });

  it("сеть платит меньше за машину", () => {
    expect(invoiceAmount(SubscriptionPlan.PRO, 40)).toBeLessThan(
      invoiceAmount(SubscriptionPlan.BASIC, 40),
    );
  });

  it("в пробном периоде счёт нулевой", () => {
    expect(invoiceAmount(SubscriptionPlan.TRIAL, 40)).toBe(0);
  });
});
