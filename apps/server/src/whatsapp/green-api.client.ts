import { Injectable, Logger } from "@nestjs/common";

import { toChatId } from "./whatsapp.rules.js";

/** Что нужно для обращения к инстансу Green-API. */
export interface GreenApiCredentials {
  apiUrl: string;
  instanceId: string;
  apiToken: string;
}

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

/**
 * Сколько ждать ответа Green-API. Дольше — значит, сервис лежит. Запрос
 * сотрудника живёт в транзакции с пределом в 20 секунд, а сохранение
 * настроек делает до трёх обращений подряд — все должны в него уложиться.
 */
const TIMEOUT_MS = 6_000;

/**
 * Тонкий клиент Green-API: отправить текст, узнать состояние инстанса,
 * прописать адрес входящих уведомлений.
 *
 * Ошибки не бросаются наружу, а возвращаются результатом: рассылка на сотню
 * гостей не должна обрываться на одном недоставленном сообщении.
 */
@Injectable()
export class GreenApiClient {
  private readonly logger = new Logger(GreenApiClient.name);

  private url(credentials: GreenApiCredentials, method: string): string {
    const base = credentials.apiUrl.replace(/\/+$/, "");
    return `${base}/waInstance${credentials.instanceId}/${method}/${credentials.apiToken}`;
  }

  private async call<T>(
    credentials: GreenApiCredentials,
    method: string,
    body?: unknown,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const response = await fetch(this.url(credentials, method), {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        // 401/403 почти всегда — неверный токен или инстанс; это видно владельцу.
        const hint =
          response.status === 401 || response.status === 403
            ? "проверьте idInstance и apiTokenInstance"
            : response.status === 466
              ? "исчерпан лимит тарифа Green-API"
              : text.slice(0, 200);
        return { ok: false, error: `Green-API ответил ${response.status}: ${hint}` };
      }

      return { ok: true, data: (await response.json()) as T };
    } catch (error) {
      this.logger.warn(`Green-API ${method}: ${(error as Error).message}`);
      return { ok: false, error: "Green-API недоступен" };
    }
  }

  async sendText(credentials: GreenApiCredentials, phone: string, message: string): Promise<SendResult> {
    const chatId = toChatId(phone);
    if (!chatId) return { ok: false, error: "Номер не разобран — проверьте его в карточке гостя" };

    const result = await this.call<{ idMessage?: string }>(credentials, "sendMessage", {
      chatId,
      message,
    });
    if (!result.ok) return result;
    return { ok: true, messageId: result.data.idMessage ?? null };
  }

  /** authorized — номер подключён и может писать; остальное — нужна привязка по QR. */
  async getState(credentials: GreenApiCredentials): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
    const result = await this.call<{ stateInstance?: string }>(credentials, "getStateInstance");
    if (!result.ok) return result;
    return { ok: true, state: result.data.stateInstance ?? "unknown" };
  }

  /**
   * Номер, к которому привязан инстанс. Green-API отдаёт его в настройках
   * как идентификатор чата («77011234567@c.us»); у непривязанного инстанса его нет.
   */
  async getAccountPhone(credentials: GreenApiCredentials): Promise<string | null> {
    const result = await this.call<{ wid?: string }>(credentials, "getSettings");
    if (!result.ok || !result.data.wid) return null;
    const match = /^(\d{10,15})@c\.us$/.exec(result.data.wid);
    return match ? match[1] : null;
  }

  /**
   * Прописывает инстансу адрес входящих уведомлений и секрет к ним.
   * Без этого ответы гостей «1» и «2» до сервера не дойдут.
   */
  async setWebhook(
    credentials: GreenApiCredentials,
    webhookUrl: string,
    webhookToken: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await this.call<{ saveSettings?: boolean }>(credentials, "setSettings", {
      webhookUrl,
      webhookUrlToken: webhookToken,
      incomingWebhook: "yes",
      outgoingWebhook: "no",
      outgoingMessageWebhook: "no",
      outgoingAPIMessageWebhook: "no",
      stateWebhook: "no",
    });
    if (!result.ok) return result;
    return { ok: true };
  }
}
