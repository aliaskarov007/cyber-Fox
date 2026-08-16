import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ApplyDecision,
  type IntentState,
  PaymentIntentStatus,
  canReuseIntent,
  decideApply,
  idempotencyKey,
  verifySignature,
} from "./payment.rules.js";

const SECRET = "webhook-secret";
const BODY = '{"id":"pay_1","amount":150000,"status":"paid"}';
const NOW = new Date("2026-03-02T20:00:00Z");

const sign = (body: string, secret = SECRET): string =>
  createHmac("sha256", secret).update(body).digest("hex");

function intent(over: Partial<IntentState> = {}): IntentState {
  return {
    status: PaymentIntentStatus.PENDING,
    amount: 150_000,
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    ...over,
  };
}

describe("подпись вебхука", () => {
  it("принимает верную подпись", () => {
    expect(verifySignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("принимает подпись с префиксом провайдера", () => {
    expect(verifySignature(BODY, `sha256=${sign(BODY)}`, SECRET)).toBe(true);
  });

  it("отвергает подпись от чужого ключа", () => {
    expect(verifySignature(BODY, sign(BODY, "другой-ключ"), SECRET)).toBe(false);
  });

  it("отвергает подпись при изменённом теле", () => {
    // Ровно то, ради чего подпись и нужна: сумму подменили после подписания.
    const tampered = BODY.replace("150000", "999999");
    expect(verifySignature(tampered, sign(BODY), SECRET)).toBe(false);
  });

  it("пустая подпись или пустой ключ — отказ", () => {
    expect(verifySignature(BODY, "", SECRET)).toBe(false);
    expect(verifySignature(BODY, sign(BODY), "")).toBe(false);
  });

  it("подпись неверной длины не роняет проверку", () => {
    expect(verifySignature(BODY, "abc", SECRET)).toBe(false);
  });
});

describe("применение подтверждения", () => {
  it("успешная оплата зачисляется", () => {
    const result = decideApply(intent(), { paid: true, amount: 150_000 }, NOW);
    expect(result.decision).toBe(ApplyDecision.APPLY);
  });

  it("повторное подтверждение не зачисляет второй раз", () => {
    // Провайдеры шлют вебхук с повторами, пока не получат 200.
    const result = decideApply(
      intent({ status: PaymentIntentStatus.SUCCEEDED }),
      { paid: true, amount: 150_000 },
      NOW,
    );
    expect(result.decision).toBe(ApplyDecision.DUPLICATE);
  });

  it("неуспешная оплата денег не даёт", () => {
    const result = decideApply(intent(), { paid: false, amount: 0 }, NOW);
    expect(result.decision).toBe(ApplyDecision.REJECT);
  });

  it("расхождение суммы решает человек, а не код", () => {
    const result = decideApply(intent(), { paid: true, amount: 100_000 }, NOW);
    expect(result.decision).toBe(ApplyDecision.CONFLICT);
    expect(result.reason).toContain("Сумма не совпадает");
  });

  it("оплата по отменённому платежу — расхождение", () => {
    const result = decideApply(
      intent({ status: PaymentIntentStatus.CANCELED }),
      { paid: true, amount: 150_000 },
      NOW,
    );
    expect(result.decision).toBe(ApplyDecision.CONFLICT);
  });

  it("опоздавшая оплата всё равно зачисляется", () => {
    // Деньги провайдер уже взял: отказ оставил бы гостя и без денег, и без
    // пополнения. Зачисляем и помечаем для разбора.
    const result = decideApply(
      intent({ expiresAt: new Date(NOW.getTime() - 60_000) }),
      { paid: true, amount: 150_000 },
      NOW,
    );
    expect(result.decision).toBe(ApplyDecision.APPLY);
    expect(result.reason).toContain("после истечения срока");
  });
});

describe("ключ идемпотентности", () => {
  it("два клика в одну минуту дают один ключ", () => {
    const first = idempotencyKey({
      purpose: "GUEST_TOPUP",
      subjectId: "guest-1",
      amount: 150_000,
      minuteBucket: 100,
    });
    const second = idempotencyKey({
      purpose: "GUEST_TOPUP",
      subjectId: "guest-1",
      amount: 150_000,
      minuteBucket: 100,
    });
    expect(first).toBe(second);
  });

  it("другая сумма — другой платёж", () => {
    const a = idempotencyKey({
      purpose: "GUEST_TOPUP",
      subjectId: "guest-1",
      amount: 150_000,
      minuteBucket: 100,
    });
    const b = idempotencyKey({
      purpose: "GUEST_TOPUP",
      subjectId: "guest-1",
      amount: 200_000,
      minuteBucket: 100,
    });
    expect(a).not.toBe(b);
  });
});

describe("переиспользование платежа", () => {
  const now = new Date("2026-08-16T10:00:00Z");
  const soon = new Date("2026-08-16T10:20:00Z");
  const past = new Date("2026-08-16T09:40:00Z");

  it("двойной клик показывает тот же неоплаченный платёж", () => {
    expect(
      canReuseIntent(
        { status: PaymentIntentStatus.PENDING, amount: 300_000, expiresAt: soon },
        now,
      ),
    ).toBe(true);
  });

  it("оплаченный платёж не переиспользуется — иначе второе пополнение пропадёт", () => {
    expect(
      canReuseIntent(
        { status: PaymentIntentStatus.SUCCEEDED, amount: 300_000, expiresAt: soon },
        now,
      ),
    ).toBe(false);
  });

  it("просроченный платёж не переиспользуется", () => {
    expect(
      canReuseIntent(
        { status: PaymentIntentStatus.PENDING, amount: 300_000, expiresAt: past },
        now,
      ),
    ).toBe(false);
  });

  it("отменённый и неудавшийся платежи заводятся заново", () => {
    for (const status of [PaymentIntentStatus.CANCELED, PaymentIntentStatus.FAILED]) {
      expect(canReuseIntent({ status, amount: 300_000, expiresAt: soon }, now)).toBe(false);
    }
  });
});
