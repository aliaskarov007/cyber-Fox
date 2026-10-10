import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  apipayAmountToTiyn,
  apipayRef,
  decideApiPay,
  maskPhone,
  tiynToTenge,
  toKaspiPhone,
  verifyApiPaySignature,
} from "./apipay.rules.js";

describe("номер для счёта в Kaspi", () => {
  it("приводит любую запись к 8XXXXXXXXXX", () => {
    expect(toKaspiPhone("+7 701 000 00 01")).toBe("87010000001");
    expect(toKaspiPhone("87010000001")).toBe("87010000001");
    expect(toKaspiPhone("7010000001")).toBe("87010000001");
    expect(toKaspiPhone("77010000001")).toBe("87010000001");
  });

  it("чужие и короткие номера не принимает", () => {
    expect(toKaspiPhone("+998 90 123 45 67")).toBeNull();
    expect(toKaspiPhone("12345")).toBeNull();
  });

  it("маскирует номер для экрана", () => {
    expect(maskPhone("87010000067")).toBe("+7 701 *** ** 67");
  });
});

describe("суммы", () => {
  it("тиын в целые тенге, дробные отклоняются", () => {
    expect(tiynToTenge(200_000)).toBe(2000);
    expect(tiynToTenge(200_050)).toBeNull();
    expect(tiynToTenge(0)).toBeNull();
  });

  it("сумма из уведомления — строка с копейками или число", () => {
    expect(apipayAmountToTiyn("2000.00")).toBe(200_000);
    expect(apipayAmountToTiyn(2000)).toBe(200_000);
    expect(apipayAmountToTiyn("175.74")).toBe(17_574);
    expect(apipayAmountToTiyn("abc")).toBeNull();
  });
});

describe("подпись уведомления", () => {
  const body = '{"event":"invoice.status_changed","invoice":{"id":42,"status":"paid"}}';
  const secret = "whsec_test";
  const good = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("верная подпись проходит", () => {
    expect(verifyApiPaySignature(body, good, secret)).toBe(true);
  });

  it("изменённое тело, чужой секрет или пустой заголовок — нет", () => {
    expect(verifyApiPaySignature(body.replace("42", "43"), good, secret)).toBe(false);
    expect(verifyApiPaySignature(body, good, "other")).toBe(false);
    expect(verifyApiPaySignature(body, undefined, secret)).toBe(false);
    expect(verifyApiPaySignature(body, good, "")).toBe(false);
  });
});

describe("что делать со статусом счёта", () => {
  it("оплачен — зачислить ровно оплаченную сумму", () => {
    expect(
      decideApiPay({ id: 42, status: "paid", amount: "2000.00", external_order_id: "intent-1" }),
    ).toEqual({ kind: "paid", invoiceId: "42", externalId: "intent-1", amount: 200_000 });
  });

  it("истёк, отменён, ошибка — платёж не состоялся", () => {
    expect(decideApiPay({ id: 1, status: "expired" })).toMatchObject({ kind: "failed", expired: true });
    expect(decideApiPay({ id: 1, status: "cancelled" })).toMatchObject({ kind: "failed", expired: false });
    expect(decideApiPay({ id: 1, status: "error", error_message: "номер не в Kaspi" })).toMatchObject({
      kind: "failed",
      reason: "Kaspi не принял счёт: номер не в Kaspi",
    });
  });

  it("промежуточные статусы и возвраты ничего не начисляют", () => {
    expect(decideApiPay({ id: 1, status: "pending" }).kind).toBe("ignore");
    expect(decideApiPay({ id: 1, status: "processing" }).kind).toBe("ignore");
    expect(decideApiPay({ id: 1, status: "partially_refunded" }).kind).toBe("ignore");
  });

  it("мусор вместо счёта игнорируется", () => {
    expect(decideApiPay(null).kind).toBe("ignore");
    expect(decideApiPay({ status: "paid" }).kind).toBe("ignore");
    expect(decideApiPay({ id: 1, status: "paid", amount: "x" }).kind).toBe("ignore");
  });

  it("ссылка на счёт помечена провайдером", () => {
    expect(apipayRef(42)).toBe("apipay:42");
  });
});
