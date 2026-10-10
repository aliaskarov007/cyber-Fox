import { Injectable, Logger } from "@nestjs/common";

const BASE_URL = "https://api.apipay.kz/api/v1";

/** Гость ждёт QR на экране: дольше ждать ApiPay бессмысленно. */
const TIMEOUT_MS = 8_000;

export type ApiPayResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string | null };

export interface ApiPayInvoice {
  id: number;
  status: string;
  amount: string;
  external_order_id?: string | null;
  error_message?: string | null;
  paid_at?: string | null;
}

export interface ApiPayQrInvoice extends ApiPayInvoice {
  qr_image_url?: string | null;
  qr_token_url?: string | null;
  qr_expires_at?: string | null;
}

/** Понятные владельцу и гостю объяснения частых отказов ApiPay. */
const ERROR_TEXT: Record<string, string> = {
  tariff_inactive: "Тариф ApiPay не активен — продлите его в кабинете ApiPay",
  tariff_limit_reached: "Исчерпан дневной лимит счетов тарифа ApiPay",
  kyc_required: "ApiPay ещё не проверил анкету бизнеса",
  kaspi_session_expired: "Кассир в ApiPay отключился от Kaspi — подключите его заново",
  invoices_disabled: "Kaspi временно не принимает счета, попробуйте через минуту",
  amount_must_be_whole_tenge: "Сумма должна быть в целых тенге",
  duplicate_idempotency_key: "Этот счёт уже выставлен",
};

/**
 * Тонкий клиент ApiPay. Ошибки возвращаются результатом, а не бросаются:
 * отказ ApiPay — обычная ситуация, о которой надо внятно сказать гостю.
 */
@Injectable()
export class ApiPayClient {
  private readonly logger = new Logger(ApiPayClient.name);

  private async call<T>(apiKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<ApiPayResult<T>> {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const text = await response.text();
      const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (!response.ok) {
        const code = typeof json.error_code === "string" ? json.error_code : null;
        const message =
          (code && ERROR_TEXT[code]) ||
          (response.status === 401 ? "ApiPay не принял ключ API — проверьте его в настройках" : null) ||
          (typeof json.error === "string" ? json.error : null) ||
          (typeof json.message === "string" ? json.message : null) ||
          `ApiPay ответил ${response.status}`;
        return { ok: false, error: message, code };
      }

      // Ответ бывает и голым объектом, и обёрнутым в data.
      const data = (json.data && typeof json.data === "object" ? json.data : json) as T;
      return { ok: true, data };
    } catch (error) {
      this.logger.warn(`ApiPay ${method} ${path}: ${(error as Error).message}`);
      return { ok: false, error: "ApiPay недоступен, попробуйте ещё раз", code: null };
    }
  }

  /** Проверка ключа при сохранении настроек. */
  health(apiKey: string): Promise<ApiPayResult<Record<string, unknown>>> {
    return this.call(apiKey, "GET", "/account/health");
  }

  /** QR на сумму: гость сканирует камерой, и Kaspi открывает именно этот счёт. */
  createQrInvoice(
    apiKey: string,
    params: { amountTenge: number; description: string; externalId: string },
  ): Promise<ApiPayResult<ApiPayQrInvoice>> {
    return this.call(apiKey, "POST", "/invoices/qr", {
      amount: params.amountTenge,
      description: params.description.slice(0, 100),
      external_order_id: params.externalId,
    });
  }

  /** Счёт на номер: гостю приходит push в приложении Kaspi. */
  createPhoneInvoice(
    apiKey: string,
    params: { phone: string; amountTenge: number; description: string; externalId: string },
  ): Promise<ApiPayResult<ApiPayInvoice>> {
    return this.call(apiKey, "POST", "/invoices", {
      phone_number: params.phone,
      amount: params.amountTenge,
      description: params.description.slice(0, 60),
      external_order_id: params.externalId,
      external_order_id_idempotency: params.externalId,
    });
  }

  /** Статус счёта — сверка, если уведомление задержалось или потерялось. */
  getInvoice(apiKey: string, invoiceId: string): Promise<ApiPayResult<ApiPayInvoice>> {
    return this.call(apiKey, "GET", `/invoices/${encodeURIComponent(invoiceId)}`);
  }
}
