import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";

import { verifySignature } from "./payment.rules.js";

export interface CheckoutRequest {
  intentId: string;
  amount: number;
  description: string;
  /** Куда вернуть плательщика после оплаты. */
  returnUrl: string;
}

export interface Checkout {
  providerRef: string;
  /** Ссылка на страницу оплаты. */
  url: string | null;
  /** Строка для QR-кода: в Казахстане платят с телефона по QR. */
  qrPayload: string | null;
}

export interface WebhookRead {
  ok: boolean;
  providerRef?: string;
  paid?: boolean;
  amount?: number;
  reason?: string;
}

/**
 * Провайдер приёма платежей.
 *
 * Интерфейс намеренно узкий: создать платёж и прочитать подтверждение.
 * Kaspi, CloudPayments и любой другой отличаются только этими двумя местами,
 * поэтому подключение нового провайдера не трогает ни кошельки, ни счета.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<Checkout>;
  readWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookRead;
}

/**
 * Провайдер по подписанному вебхуку — общая схема почти всех касс.
 *
 * Настраивается переменными окружения: адрес страницы оплаты и секрет для
 * подписи. Боевое подключение Kaspi требует договора мерчанта и их формата
 * запроса; здесь реализована общая часть, к которой он сводится.
 */
@Injectable()
export class HmacPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(HmacPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  get name(): string {
    return this.config.get<string>("PAYMENT_PROVIDER") ?? "manual";
  }

  private get secret(): string {
    return this.config.get<string>("PAYMENT_WEBHOOK_SECRET") ?? "";
  }

  async createCheckout(request: CheckoutRequest): Promise<Checkout> {
    const providerRef = `cf_${randomUUID()}`;
    const base = this.config.get<string>("PAYMENT_CHECKOUT_URL");

    if (!base) {
      /*
       * Провайдер не настроен: платёж всё равно создаётся, но оплачивается
       * вручную на стойке. Так клуб работает с первого дня, не дожидаясь
       * договора с банком, а переход на онлайн-оплату — это настройка,
       * а не переделка.
       */
      this.logger.debug("Провайдер оплаты не настроен: платёж подтверждается вручную");
      return { providerRef, url: null, qrPayload: null };
    }

    const url = new URL(base);
    url.searchParams.set("ref", providerRef);
    url.searchParams.set("amount", String(request.amount));
    url.searchParams.set("description", request.description);
    url.searchParams.set("return", request.returnUrl);

    return { providerRef, url: url.toString(), qrPayload: url.toString() };
  }

  readWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookRead {
    const signature = headers["x-signature"] ?? headers["x-payment-signature"] ?? "";

    if (!this.secret) {
      return { ok: false, reason: "Секрет вебхука не настроен" };
    }
    if (!verifySignature(rawBody, signature, this.secret)) {
      return { ok: false, reason: "Неверная подпись" };
    }

    try {
      const payload = JSON.parse(rawBody) as {
        ref?: string;
        status?: string;
        amount?: number;
      };
      if (!payload.ref) return { ok: false, reason: "В подтверждении нет идентификатора платежа" };

      return {
        ok: true,
        providerRef: payload.ref,
        paid: payload.status === "paid" || payload.status === "success",
        amount: payload.amount,
      };
    } catch {
      return { ok: false, reason: "Подтверждение не разобрано" };
    }
  }
}
