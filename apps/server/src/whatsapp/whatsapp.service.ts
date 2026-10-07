import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InviteStatus, type WhatsAppChannel } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { GuestSignupService } from "../guest-signup/guest-signup.service.js";
import { findGuestByPhone } from "../guests/guest-lookup.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type GreenApiCredentials, GreenApiClient, type SendResult } from "./green-api.client.js";
import type { SaveWhatsAppDto } from "./whatsapp.dto.js";
import { STOP_ACK, VERIFIED_ACK, parseInviteReply, readIncoming, replyAck } from "./whatsapp.rules.js";

/** Канал глазами кассы: без токена, с которым можно писать от имени клуба. */
export interface PublicChannel {
  connected: boolean;
  apiUrl: string | null;
  instanceId: string | null;
  /** Последние символы токена — видно, какой стоит, но не сам токен. */
  apiTokenHint: string | null;
  /** Номер клуба в WhatsApp: на него гости пишут код регистрации. */
  phone: string | null;
  /** authorized — номер привязан и может писать. */
  state: string | null;
  lastCheckAt: Date | null;
  /** Когда пришло последнее сообщение — видно, доходят ли ответы гостей. */
  lastIncomingAt: Date | null;
  webhookPath: string;
}

const WEBHOOK_PATH = "/api/whatsapp/webhook";

export function credentialsOf(channel: WhatsAppChannel): GreenApiCredentials {
  return { apiUrl: channel.apiUrl, instanceId: channel.instanceId, apiToken: channel.apiToken };
}

function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * WhatsApp сети через Green-API: подключение номера, отправка и входящие.
 *
 * Green-API держит сессию приложения WhatsApp (лучше WhatsApp Business) на
 * телефоне клуба. В отличие от Cloud API от Meta, номер остаётся в приложении на
 * телефоне, а подключение — это QR-код и два поля в кассе, без аккаунта
 * разработчика и проверки компании.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly greenApi: GreenApiClient,
    private readonly signups: GuestSignupService,
  ) {}

  private toPublic(channel: WhatsAppChannel | null): PublicChannel {
    return {
      connected: channel !== null,
      apiUrl: channel?.apiUrl ?? null,
      instanceId: channel?.instanceId ?? null,
      apiTokenHint: channel ? `…${channel.apiToken.slice(-4)}` : null,
      phone: channel?.phone ?? null,
      state: channel?.lastState ?? null,
      lastCheckAt: channel?.lastCheckAt ?? null,
      lastIncomingAt: channel?.lastIncomingAt ?? null,
      webhookPath: WEBHOOK_PATH,
    };
  }

  async get(staff: AuthenticatedStaff): Promise<PublicChannel> {
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { tenantId: staff.tenantId } });
    return this.toPublic(channel);
  }

  /**
   * Сохраняет подключение, сразу проверяет его, узнаёт номер клуба и
   * прописывает адрес входящих. Неверный токен лучше узнать здесь, а не по
   * гостю, который отправил код и ждёт у экрана.
   */
  async save(staff: AuthenticatedStaff, dto: SaveWhatsAppDto): Promise<PublicChannel & { warning: string | null }> {
    const existing = await this.prisma.whatsAppChannel.findUnique({ where: { tenantId: staff.tenantId } });
    const apiToken = dto.apiToken?.trim() || existing?.apiToken;
    if (!apiToken) throw new BadRequestException("Укажите apiTokenInstance из кабинета Green-API");

    const taken = await this.prisma.whatsAppChannel.findUnique({ where: { instanceId: dto.instanceId } });
    if (taken && taken.tenantId !== staff.tenantId) {
      throw new BadRequestException("Этот инстанс Green-API уже подключён к другой сети");
    }

    const credentials: GreenApiCredentials = {
      apiUrl: dto.apiUrl?.trim() || existing?.apiUrl || "https://api.green-api.com",
      instanceId: dto.instanceId,
      apiToken,
    };

    const state = await this.greenApi.getState(credentials);
    if (!state.ok) throw new BadRequestException(state.error);
    const phone = state.state === "authorized" ? await this.greenApi.getAccountPhone(credentials) : null;

    const channel = await this.prisma.whatsAppChannel.upsert({
      where: { tenantId: staff.tenantId },
      create: { tenantId: staff.tenantId, ...credentials, phone, lastState: state.state, lastCheckAt: new Date() },
      update: { ...credentials, phone, lastState: state.state, lastCheckAt: new Date() },
    });

    let warning: string | null = null;
    if (state.state !== "authorized") {
      warning = "Инстанс не авторизован: отсканируйте QR-код в кабинете Green-API телефоном клуба.";
    }

    if (dto.publicUrl) {
      const webhookUrl = `${dto.publicUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
      const hook = await this.greenApi.setWebhook(credentials, webhookUrl, channel.webhookToken);
      if (!hook.ok) warning = `Адрес входящих не прописан: ${hook.error}`;
    } else {
      warning ??=
        "Касса открыта не по публичному https-адресу — сообщения гостей до сервера не дойдут: " +
        "регистрация за ПК будет ждать подтверждения на стойке.";
    }

    return { ...this.toPublic(channel), warning };
  }

  async checkState(staff: AuthenticatedStaff): Promise<PublicChannel> {
    const channel = await this.requireChannel(staff.tenantId);
    const state = await this.greenApi.getState(credentialsOf(channel));
    if (!state.ok) throw new BadRequestException(state.error);

    const phone = state.state === "authorized" ? await this.greenApi.getAccountPhone(credentialsOf(channel)) : null;
    const updated = await this.prisma.whatsAppChannel.update({
      where: { id: channel.id },
      // Номер переживает временную потерю связи: заменяем, только если узнали новый.
      data: { lastState: state.state, lastCheckAt: new Date(), ...(phone ? { phone } : {}) },
    });
    return this.toPublic(updated);
  }

  async disconnect(staff: AuthenticatedStaff): Promise<PublicChannel> {
    await this.prisma.whatsAppChannel.deleteMany({ where: { tenantId: staff.tenantId } });
    return this.toPublic(null);
  }

  async sendTest(staff: AuthenticatedStaff, phone: string): Promise<{ ok: true }> {
    const result = await this.send(staff.tenantId, phone, "Проверка связи: WhatsApp клуба подключён ✅");
    if (!result.ok) throw new BadRequestException(result.error);
    return { ok: true };
  }

  async requireChannel(tenantId: string): Promise<WhatsAppChannel> {
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { tenantId } });
    if (!channel) {
      throw new NotFoundException("WhatsApp не подключён: владелец сети подключает его в настройках");
    }
    return channel;
  }

  /** Отправка от имени сети. Ошибку возвращает, а не бросает: рассылка не должна обрываться. */
  async send(tenantId: string, phone: string, message: string): Promise<SendResult> {
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { tenantId } });
    if (!channel) return { ok: false, error: "WhatsApp не подключён" };
    return this.greenApi.sendText(credentialsOf(channel), phone, message);
  }

  /**
   * Входящее уведомление Green-API.
   *
   * Отвечаем всегда «принято», даже на мусор: иначе Green-API повторяет
   * доставку, и одно сообщение гостя обрабатывается несколько раз.
   * Подлинность проверяется секретом, который сервер сам прописал инстансу:
   * без неё любой, кто знает адрес, подтвердил бы себе чужой номер.
   */
  async handleWebhook(authorization: string | undefined, payload: unknown): Promise<void> {
    const incoming = readIncoming(payload);
    if (!incoming) return;

    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { instanceId: incoming.instanceId } });
    if (!channel) return;

    const received = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!tokensMatch(channel.webhookToken, received)) {
      this.logger.warn(`Уведомление для инстанса ${incoming.instanceId} без верного секрета — пропущено`);
      return;
    }

    await this.prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: { lastIncomingAt: new Date() },
    });

    const reply = async (text: string) => {
      const ack = await this.greenApi.sendText(credentialsOf(channel), incoming.from, text);
      if (!ack.ok) this.logger.warn(`Ответ гостю не ушёл: ${ack.error}`);
    };

    // Код регистрации и «СТОП» разбирает регистрация.
    const handled = await this.signups.handleIncoming(channel.tenantId, incoming);
    if (handled === "verified") return reply(VERIFIED_ACK);
    if (handled === "stopped") return reply(STOP_ACK);

    const answer = parseInviteReply(incoming.text);
    if (!answer) return;

    const guest = await findGuestByPhone(this.prisma, channel.tenantId, incoming.from);
    if (!guest) return;

    // Отвечают на последнее полученное приглашение на ивент, который ещё впереди.
    const invite = await this.prisma.eventInvite.findFirst({
      where: {
        guestId: guest.id,
        status: { in: [InviteStatus.SENT, InviteStatus.GOING, InviteStatus.DECLINED] },
        event: { startsAt: { gt: new Date() } },
      },
      orderBy: { sentAt: "desc" },
      include: { event: { select: { title: true } } },
    });
    // «1» без приглашения — просто сообщение; его прочтёт человек на телефоне клуба.
    if (!invite) return;

    await this.prisma.eventInvite.update({
      where: { id: invite.id },
      data: { status: answer === "going" ? InviteStatus.GOING : InviteStatus.DECLINED, respondedAt: new Date() },
    });
    await reply(replyAck(answer, invite.event.title));
  }
}
