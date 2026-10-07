import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import { Public } from "../auth/guards.js";
import { GuestSignupService } from "./guest-signup.service.js";
import { WhatsappMonitor } from "./whatsapp.monitor.js";
import { parseIncoming, signatureValid } from "./whatsapp.rules.js";

/**
 * Вебхук WhatsApp Cloud API: сюда Meta присылает сообщения, написанные клубу.
 *
 * Адрес для настройки в Meta: https://<домен клуба>/api/whatsapp/webhook.
 */
@Controller("whatsapp/webhook")
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly signup: GuestSignupService,
    private readonly config: ConfigService,
    private readonly monitor: WhatsappMonitor,
  ) {}

  /** Проверка адреса при подключении: Meta ждёт обратно свой challenge. */
  @Public()
  @Get()
  verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ): string {
    const expected = this.config.get<string>("WHATSAPP_VERIFY_TOKEN")?.trim();
    if (!expected || mode !== "subscribe" || token !== expected) {
      throw new ForbiddenException("Неверный токен проверки");
    }
    this.monitor.verified();
    return challenge;
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const secret = this.config.get<string>("WHATSAPP_APP_SECRET")?.trim();
    if (!secret) throw new NotFoundException("WhatsApp не подключён");

    const raw = request.rawBody?.toString("utf8") ?? "";
    if (!signatureValid(raw, signature, secret)) {
      // Чаще всего это не атака, а не тот App Secret в настройках сервера.
      this.monitor.signatureFailed();
      throw new ForbiddenException("Подпись не сходится");
    }

    for (const message of parseIncoming(body)) {
      this.monitor.message(message.from);
      try {
        await this.signup.handleIncoming(message);
      } catch (error) {
        // Одно сломанное сообщение не должно заставлять Meta слать всю пачку снова.
        this.logger.error(`Сообщение WhatsApp не обработано: ${(error as Error).message}`);
      }
    }
    return { ok: true };
  }
}
