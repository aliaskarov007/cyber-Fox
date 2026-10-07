import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InviteStatus, type WhatsAppChannel } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type GreenApiCredentials, GreenApiClient, type SendResult } from "./green-api.client.js";
import type { SaveWhatsAppDto } from "./whatsapp.dto.js";
import { findGuestByPhone } from "../guests/guest-phone.js";
import { GuestSignupService } from "./guest-signup.service.js";
import { findSignupCode, parseInviteReply, readIncoming, replyAck } from "./whatsapp.rules.js";

/** Канал глазами кассового экрана: без токена, с которым можно писать от имени клуба. */
export interface PublicChannel {
  connected: boolean;
  apiUrl: string | null;
  instanceId: string | null;
  /** Последние символы токена — чтобы было видно, какой стоит, но не сам токен. */
  apiTokenHint: string | null;
  /** Номер клуба в WhatsApp — на него пишут гости. */
  phone: string | null;
  state: string | null;
  lastCheckAt: Date | null;
  /** Куда Green-API шлёт ответы гостей. Пусто — ещё не прописан. */
  webhookPath: string;
}

const WEBHOOK_PATH = "/api/whatsapp/webhook";

function credentialsOf(channel: WhatsAppChannel): GreenApiCredentials {
  return { apiUrl: channel.apiUrl, instanceId: channel.instanceId, apiToken: channel.apiToken };
}

function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
      webhookPath: WEBHOOK_PATH,
    };
  }

  async get(staff: AuthenticatedStaff): Promise<PublicChannel> {
    const channel = await this.prisma.whatsAppChannel.findUnique({ where: { tenantId: staff.tenantId } });
    return this.toPublic(channel);
  }

  /**
   * Сохраняет подключение, сразу проверяет его и прописывает адрес ответов.
   * Неверный токен лучше узнать здесь, у владельца, чем завтра — по тишине
   * в ответ на рассылку.
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

    // Номер нужен регистрации за ПК: на него гость отправляет код из QR.
    const phone = state.state === "authorized" ? await this.greenApi.getAccountPhone(credentials) : null;

    const channel = await this.prisma.whatsAppChannel.upsert({
      where: { tenantId: staff.tenantId },
      create: {
        tenantId: staff.tenantId,
        ...credentials,
        phone,
        lastState: state.state,
        lastCheckAt: new Date(),
      },
      update: { ...credentials, phone, lastState: state.state, lastCheckAt: new Date() },
    });

    let warning: string | null = null;
    if (state.state !== "authorized") {
      warning = "Инстанс не авторизован: отсканируйте QR-код в кабинете Green-API телефоном клуба.";
    }

    if (dto.publicUrl) {
      const webhookUrl = `${dto.publicUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
      const hook = await this.greenApi.setWebhook(credentials, webhookUrl, channel.webhookToken);
      if (!hook.ok) warning = `Адрес ответов не прописан: ${hook.error}`;
    } else {
      warning ??= "Сервер открыт не по публичному https-адресу — ответы гостей «1»/«2» не дойдут, рассылка работает.";
    }

    return { ...this.toPublic(channel), warning };
  }

  async checkState(staff: AuthenticatedStaff): Promise<PublicChannel> {
    const channel = await this.requireChannel(staff.tenantId);
    const state = await this.greenApi.getState(credentialsOf(channel));
    if (!state.ok) throw new BadRequestException(state.error);

    const phone =
      state.state === "authorized" ? await this.greenApi.getAccountPhone(credentialsOf(channel)) : null;
    const updated = await this.prisma.whatsAppChannel.update({
      where: { id: channel.id },
      // Номер переживает временную потерю связи: стираем его, только если узнали новый.
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

  /** Отправка от имени сети. Ошибку возвращает, а не бросает — см. GreenApiClient. */
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
   * Подлинность проверяется секретом, который сервер сам прописал инстансу.
   */
  async handleWebhook(authorization: string | undefined, payload: unknown): Promise<void> {
    const incoming = readIncoming(payload);
    if (!incoming) return;

    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { instanceId: incoming.instanceId },
    });
    if (!channel) return;

    const received = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!tokensMatch(channel.webhookToken, received)) {
      this.logger.warn(`Уведомление для инстанса ${incoming.instanceId} без верного секрета — пропущено`);
      return;
    }

    // Код регистрации с игрового ПК — его ищем первым: в сообщении он один,
    // и спутать его с ответом на приглашение нельзя.
    const signupCode = findSignupCode(incoming.text);
    if (signupCode) {
      const ackText = await this.signups.confirm(channel.tenantId, signupCode, incoming.phone);
      if (ackText) {
        const ack = await this.greenApi.sendText(credentialsOf(channel), incoming.phone, ackText);
        if (!ack.ok) this.logger.warn(`Подтверждение регистрации гостю не ушло: ${ack.error}`);
      }
      return;
    }

    const reply = parseInviteReply(incoming.text);
    if (!reply) return;

    const guest = await findGuestByPhone(this.prisma, channel.tenantId, incoming.phone);
    if (!guest) return;

    let eventTitle: string | null = null;

    if (reply === "stop" || reply === "start") {
      await this.prisma.guest.update({
        where: { id: guest.id },
        data: { invitesOptOutAt: reply === "stop" ? new Date() : null },
      });
    } else {
      // Отвечают на последнее полученное приглашение на ивент, который ещё впереди.
      const invite = await this.prisma.eventInvite.findFirst({
        where: {
          guestId: guest.id,
          status: { in: [InviteStatus.SENT, InviteStatus.GOING, InviteStatus.DECLINED] },
          event: { canceledAt: null, startsAt: { gt: new Date() } },
        },
        orderBy: { sentAt: "desc" },
        include: { event: { select: { title: true } } },
      });
      // Ответ «1» без приглашения — просто сообщение, не наше дело на него отвечать.
      if (!invite) return;

      await this.prisma.eventInvite.update({
        where: { id: invite.id },
        data: {
          status: reply === "going" ? InviteStatus.GOING : InviteStatus.DECLINED,
          respondedAt: new Date(),
        },
      });
      eventTitle = invite.event.title;
    }

    const ack = await this.greenApi.sendText(credentialsOf(channel), incoming.phone, replyAck(reply, eventTitle));
    if (!ack.ok) this.logger.warn(`Подтверждение ответа гостю не ушло: ${ack.error}`);
  }
}
