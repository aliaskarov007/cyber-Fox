import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Правила приёма платежей — чистые функции.
 *
 * Это внешний рубеж системы: сюда приходит запрос из интернета, который
 * добавляет гостю деньги. Поэтому проверки собраны в одном месте и покрыты
 * тестами, а не размазаны по обработчику.
 */

export const PaymentIntentStatus = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
  EXPIRED: "EXPIRED",
} as const;
export type PaymentIntentStatus =
  (typeof PaymentIntentStatus)[keyof typeof PaymentIntentStatus];

/**
 * Проверка подписи вебхука.
 *
 * Сравнение постоянного времени обязательно: обычное `===` выходит из цикла на
 * первом несовпавшем байте, и по времени ответа подпись подбирается посимвольно.
 */
export function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.trim().toLowerCase().replace(/^sha256=/, "");

  // Буферы разной длины timingSafeEqual не принимает — отвечаем сразу.
  if (expected.length !== given.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
}

export const ApplyDecision = {
  /** Зачисляем деньги. */
  APPLY: "APPLY",
  /** Уже зачислено — повторное подтверждение игнорируем. */
  DUPLICATE: "DUPLICATE",
  /** Платёж не прошёл: помечаем и денег не даём. */
  REJECT: "REJECT",
  /** Расхождение, которое нельзя решать автоматически. */
  CONFLICT: "CONFLICT",
} as const;
export type ApplyDecision = (typeof ApplyDecision)[keyof typeof ApplyDecision];

export interface IntentState {
  status: PaymentIntentStatus;
  amount: number;
  expiresAt: Date;
}

export interface WebhookClaim {
  /** Что говорит провайдер: платёж прошёл или нет. */
  paid: boolean;
  /** Сумма из подтверждения, в тиын. */
  amount: number;
}

/**
 * Что делать с пришедшим подтверждением.
 *
 * Два правила, за которые тут отвечаем:
 *   1. Подтверждение приходит несколько раз — зачислять можно только однажды.
 *   2. Сумма из подтверждения должна совпадать с тем, что мы выставили;
 *      иначе это либо ошибка провайдера, либо подмена, и решать её должен
 *      человек, а не код.
 */
export function decideApply(
  intent: IntentState,
  claim: WebhookClaim,
  now: Date,
): { decision: ApplyDecision; reason: string | null } {
  if (intent.status === PaymentIntentStatus.SUCCEEDED) {
    return { decision: ApplyDecision.DUPLICATE, reason: null };
  }

  if (!claim.paid) {
    return { decision: ApplyDecision.REJECT, reason: "Провайдер сообщил о неуспешной оплате" };
  }

  if (
    intent.status === PaymentIntentStatus.CANCELED ||
    intent.status === PaymentIntentStatus.FAILED
  ) {
    return {
      decision: ApplyDecision.CONFLICT,
      reason: "Оплата пришла по отменённому платежу",
    };
  }

  if (claim.amount !== intent.amount) {
    return {
      decision: ApplyDecision.CONFLICT,
      reason: `Сумма не совпадает: выставлено ${intent.amount}, оплачено ${claim.amount}`,
    };
  }

  /*
   * Просроченное намерение с успешной оплатой — не повод отказать гостю.
   * Деньги провайдер уже взял; отклонить значит оставить человека без
   * пополнения и без денег. Зачисляем и помечаем для разбора.
   */
  if (intent.expiresAt <= now) {
    return {
      decision: ApplyDecision.APPLY,
      reason: "Оплата пришла после истечения срока платежа",
    };
  }

  return { decision: ApplyDecision.APPLY, reason: null };
}

/** Ключ идемпотентности создания платежа: повторный клик не плодит счета. */
export function idempotencyKey(parts: {
  purpose: string;
  subjectId: string;
  amount: number;
  /** Окно склейки: клики в пределах минуты считаются одним намерением. */
  minuteBucket: number;
}): string {
  return [parts.purpose, parts.subjectId, parts.amount, parts.minuteBucket].join(":");
}

export function minuteBucket(now: Date): number {
  return Math.floor(now.getTime() / 60_000);
}

/**
 * Годится ли найденный по ключу платёж, чтобы показать его снова.
 *
 * Склейка по минуте защищает от двойного клика, но она же может подсунуть
 * гостю прошлый платёж: если он положил 3 000 ₸ и тут же хочет положить ещё
 * столько же, ключ совпадёт. Поэтому переиспользуем только то, что ещё не
 * закрыто, — оплаченный или отменённый платёж нужно заводить заново.
 */
export function canReuseIntent(intent: IntentState, now: Date): boolean {
  return intent.status === PaymentIntentStatus.PENDING && intent.expiresAt > now;
}
