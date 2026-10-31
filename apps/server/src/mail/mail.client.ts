import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type MailResult = { ok: true } | { ok: false; error: string };

/** Сколько ждать ответа почтового сервиса. Дольше — значит, он лежит. */
const TIMEOUT_MS = 8_000;

/**
 * Отправка писем через Resend (resend.com): HTTPS, без SMTP.
 *
 * SMTP-порты у облачных хостингов часто закрыты, а обычный HTTPS проходит
 * всегда. Ключ — RESEND_API_KEY, отправитель — MAIL_FROM. Без ключа письма
 * не уходят, и сервер говорит об этом в журнале, а не молчит.
 */
@Injectable()
export class MailClient {
  private readonly logger = new Logger(MailClient.name);

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get<string>("RESEND_API_KEY")?.trim());
  }

  async send(to: string, subject: string, text: string): Promise<MailResult> {
    const key = this.config.get<string>("RESEND_API_KEY")?.trim();
    if (!key)
      return { ok: false, error: "Почта не настроена: нет RESEND_API_KEY" };
    const from =
      this.config.get<string>("MAIL_FROM")?.trim() ||
      "CyberFox <noreply@cyberfoxclub.com>";

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Resend ответил ${response.status}: ${body.slice(0, 200)}`,
        };
      }
      return { ok: true };
    } catch (error) {
      this.logger.warn(`Resend: ${(error as Error).message}`);
      return { ok: false, error: "Resend недоступен" };
    }
  }
}
