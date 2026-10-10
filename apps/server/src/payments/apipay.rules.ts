import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Правила ApiPay без сети и базы: формат номера, суммы, подпись уведомления и
 * что делать с каждым статусом счёта.
 */

/** Префикс нашей ссылки на счёт ApiPay: так платёж не спутать с другими провайдерами. */
export const APIPAY_REF_PREFIX = "apipay:";

export function apipayRef(invoiceId: number | string): string {
  return `${APIPAY_REF_PREFIX}${invoiceId}`;
}

/**
 * Номер для счёта в Kaspi: 11 цифр с ведущей восьмёркой, как требует ApiPay.
 * В базе номер может быть записан как угодно — «+7 701…», «8701…», «701…».
 */
export function toKaspiPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("7")) return `8${digits}`;
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `8${digits.slice(1)}`;
  }
  return null;
}

/** «+7 701 *** ** 67» — показать гостю, куда ушёл счёт, не светя номер соседям. */
export function maskPhone(kaspiPhone: string): string {
  const d = kaspiPhone.slice(1);
  return `+7 ${d.slice(0, 3)} *** ** ${d.slice(8, 10)}`;
}

/** Тиын → целые тенге для ApiPay. Счёт на телефон дробной суммы не принимает. */
export function tiynToTenge(amount: number): number | null {
  if (!Number.isInteger(amount) || amount <= 0 || amount % 100 !== 0) return null;
  return amount / 100;
}

/** «2000.00» или 2000 из уведомления → тиын. Неразборчивое — null, а не ноль. */
export function apipayAmountToTiyn(value: unknown): number | null {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

/**
 * Подпись уведомления: `sha256=<hex>` от HMAC-SHA256 сырого тела на секрете
 * из кабинета ApiPay. Сравнение за постоянное время: по времени ответа
 * подпись не подобрать.
 */
export function verifyApiPaySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ApiPayAction =
  | { kind: "paid"; invoiceId: string; externalId: string | null; amount: number }
  | { kind: "failed"; invoiceId: string; externalId: string | null; reason: string; expired: boolean }
  | { kind: "ignore"; reason: string };

/** Что гостю сказать, если счёт не состоялся. */
const FAILURE_TEXT: Record<string, string> = {
  cancelled: "Счёт отменён",
  expired: "Время на оплату истекло",
  error: "Kaspi не принял счёт",
};

/**
 * Что делать с уведомлением или ответом на запрос статуса.
 *
 * Зачисляется только `paid`. Возвраты (`partially_refunded`) деньги гостю не
 * начисляют — их разбирает человек. Промежуточные статусы ничего не меняют.
 */
export function decideApiPay(invoice: unknown): ApiPayAction {
  const inv = (invoice ?? {}) as {
    id?: unknown;
    status?: unknown;
    amount?: unknown;
    external_order_id?: unknown;
    error_message?: unknown;
  };
  if (inv.id === undefined || inv.id === null || typeof inv.status !== "string") {
    return { kind: "ignore", reason: "В уведомлении нет счёта" };
  }
  const invoiceId = String(inv.id);
  const externalId = typeof inv.external_order_id === "string" && inv.external_order_id ? inv.external_order_id : null;

  if (inv.status === "paid") {
    const amount = apipayAmountToTiyn(inv.amount);
    if (amount === null) return { kind: "ignore", reason: "Сумма оплаты не разобрана" };
    return { kind: "paid", invoiceId, externalId, amount };
  }

  if (inv.status in FAILURE_TEXT) {
    const detail = typeof inv.error_message === "string" && inv.error_message ? `: ${inv.error_message}` : "";
    return {
      kind: "failed",
      invoiceId,
      externalId,
      reason: `${FAILURE_TEXT[inv.status]}${inv.status === "error" ? detail : ""}`,
      expired: inv.status === "expired",
    };
  }

  return { kind: "ignore", reason: `Статус ${inv.status} ничего не меняет` };
}
