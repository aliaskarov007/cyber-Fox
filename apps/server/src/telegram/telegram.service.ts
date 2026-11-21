import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

/** Сколько ждать ответа Telegram. Дольше — значит сервис недоступен. */
const TIMEOUT_MS = 6_000;

const API = "https://api.telegram.org";

/**
 * Уведомления о действиях клуба в Telegram.
 *
 * Токен бота и id чата хранятся на клубе (их вписывает владелец). Отправка —
 * «выстрелил и забыл»: ошибка Telegram не должна ронять пополнение, продажу или
 * закрытие смены, поэтому наружу ничего не бросается, всё уходит в журнал.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Отправить уведомление по действию в клубе. Ничего не делает, если Telegram
   * у клуба не настроен. Никогда не бросает и не задерживает вызывающего.
   */
  notify(clubId: string, text: string): void {
    void this.send(clubId, text).catch((error) => {
      this.logger.warn(`Telegram-уведомление не ушло: ${message(error)}`);
    });
  }

  private async send(clubId: string, text: string): Promise<void> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { telegramBotToken: true, telegramChatId: true, name: true },
    });
    if (!club?.telegramBotToken || !club?.telegramChatId) return;
    await this.post(club.telegramBotToken, {
      chat_id: club.telegramChatId,
      text: `🦊 ${club.name}\n${text}`,
      disable_web_page_preview: true,
    });
  }

  /**
   * Подключить чат: по токену найти, куда бот добавлен, сохранить id и послать
   * проверочное сообщение. Так владельцу не нужно вручную искать числовой id —
   * достаточно добавить бота в группу и нажать «Подключить».
   */
  async connect(
    clubId: string,
    botToken: string,
  ): Promise<{ ok: true; chatId: string } | { ok: false; error: string }> {
    const token = botToken.trim();
    if (!token) return { ok: false, error: "Укажите токен бота" };

    const chatId = await this.discoverChatId(token);
    if (!chatId) {
      return {
        ok: false,
        error:
          "Не вижу чат. Добавьте бота в нужную группу и напишите там любое " +
          "сообщение, затем нажмите «Подключить» ещё раз.",
      };
    }

    await this.prisma.club.update({
      where: { id: clubId },
      data: { telegramBotToken: token, telegramChatId: chatId },
    });
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true },
    });
    const sent = await this.post(token, {
      chat_id: chatId,
      text: `✅ Cyber-Fox подключён к «${club?.name ?? "клубу"}». Сюда будут приходить уведомления о действиях.`,
    });
    if (!sent.ok) return { ok: false, error: sent.error };
    return { ok: true, chatId };
  }

  /** Найти id чата по последним апдейтам бота (сообщение или добавление в группу). */
  private async discoverChatId(token: string): Promise<string | null> {
    const res = await this.getJson<{
      ok: boolean;
      result: Array<{
        message?: { chat?: { id: number } };
        my_chat_member?: { chat?: { id: number } };
        channel_post?: { chat?: { id: number } };
      }>;
    }>(token, "getUpdates", { timeout: 2, allowed_updates: [] });
    if (!res.ok || !res.data.ok) return null;
    // Берём самый свежий чат, какой бот видел.
    for (const update of [...res.data.result].reverse()) {
      const id =
        update.message?.chat?.id ??
        update.channel_post?.chat?.id ??
        update.my_chat_member?.chat?.id;
      if (id !== undefined) return String(id);
    }
    return null;
  }

  private async post(
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const res = await this.getJson<{ ok: boolean; description?: string }>(
      token,
      "sendMessage",
      body,
    );
    if (!res.ok) return { ok: false, error: res.error };
    if (!res.data.ok) {
      return { ok: false, error: res.data.description ?? "Telegram отклонил" };
    }
    return { ok: true };
  }

  private async getJson<T>(
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const response = await fetch(`${API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const hint =
          response.status === 401 || response.status === 404
            ? "проверьте токен бота"
            : text.slice(0, 200);
        return { ok: false, error: `Telegram ${response.status}: ${hint}` };
      }
      return { ok: true, data: (await response.json()) as T };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
