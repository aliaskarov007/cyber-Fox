import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { type ClubEvent, InviteStatus, type Prisma } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  INVITES_PER_PERIOD,
  INVITE_PERIOD_MS,
  SEND_BATCH,
  SEND_PAUSE_MS,
  inviteMessage,
} from "./whatsapp.rules.js";
import { WhatsAppService } from "./whatsapp.service.js";

export type Audience = "NETWORK" | "CLUB";

export interface InviteSummary {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  going: number;
  declined: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Приглашения на ивенты афиши в WhatsApp.
 *
 * Афиша видна на экранах ПК всей сети; приглашение доводит её до тех, кто
 * сейчас не в клубе. Писать можно только тем, кто на это согласился, с
 * подтверждённым номером и не отписался, — и не чаще двух раз в месяц:
 * так обещано в тексте согласия (docs/guest-access.md, раздел 2.1).
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private async requireEvent(staff: AuthenticatedStaff, eventId: string): Promise<ClubEvent> {
    const event = await this.prisma.clubEvent.findUnique({ where: { id: eventId } });
    if (!event || event.tenantId !== staff.tenantId) throw new NotFoundException("Ивент не найден");
    return event;
  }

  /** Кого можно пригласить. CLUB — зарегистрированные в зале ивента или игравшие в нём. */
  private audienceWhere(tenantId: string, event: ClubEvent, audience: Audience): Prisma.GuestWhereInput {
    return {
      tenantId,
      phoneVerifiedAt: { not: null },
      marketingConsentAt: { not: null },
      marketingOptOutAt: null,
      ...(audience === "CLUB" && event.clubId
        ? { OR: [{ registeredClubId: event.clubId }, { sessions: { some: { clubId: event.clubId } } }] }
        : {}),
    };
  }

  /**
   * Кому уйдёт приглашение. Лимит частоты — у кого уже два приглашения за
   * месяц, тот в этот раз пропускается — досчитывается здесь: Prisma не умеет
   * «не больше N связанных записей» одним условием.
   */
  private async eligibleGuestIds(tenantId: string, event: ClubEvent, audience: Audience): Promise<string[]> {
    const base = this.audienceWhere(tenantId, event, audience);
    const since = new Date(Date.now() - INVITE_PERIOD_MS);
    const guests = await this.prisma.guest.findMany({
      where: base,
      select: {
        id: true,
        invites: { where: { sentAt: { gt: since } }, select: { id: true } },
      },
    });
    return guests.filter((g) => g.invites.length < INVITES_PER_PERIOD).map((g) => g.id);
  }

  async audienceSize(staff: AuthenticatedStaff, eventId: string, audience: Audience) {
    const event = await this.requireEvent(staff, eventId);
    const eligible = await this.eligibleGuestIds(staff.tenantId, event, audience);
    // Подсказка: столько гостей с согласием пропустит рассылка, пока не подтвердят номер.
    const unverified = await this.prisma.guest.count({
      where: {
        tenantId: staff.tenantId,
        marketingConsentAt: { not: null },
        marketingOptOutAt: null,
        phoneVerifiedAt: null,
      },
    });
    return { guests: eligible.length, unverified };
  }

  /**
   * Ставит приглашения в очередь; уходят они фоновым проходом с паузами.
   * Повторная рассылка дошлёт только тем, кто стал доступен после первой.
   */
  async send(staff: AuthenticatedStaff, eventId: string, audience: Audience): Promise<{ queued: number }> {
    const event = await this.requireEvent(staff, eventId);
    if (!event.isPublished) throw new BadRequestException("Ивент снят с афиши — сначала опубликуйте его");
    if (event.startsAt <= new Date()) throw new BadRequestException("Ивент уже начался — приглашать поздно");
    await this.whatsapp.requireChannel(staff.tenantId);

    const guestIds = await this.eligibleGuestIds(staff.tenantId, event, audience);
    const { count } = await this.prisma.eventInvite.createMany({
      data: guestIds.map((guestId) => ({ eventId, guestId })),
      skipDuplicates: true,
    });
    await this.prisma.clubEvent.update({ where: { id: eventId }, data: { invitesSentAt: new Date() } });
    return { queued: count };
  }

  /** Сводка по приглашениям для списка афиши. */
  async summaries(staff: AuthenticatedStaff): Promise<Record<string, InviteSummary>> {
    const groups = await this.prisma.eventInvite.groupBy({
      by: ["eventId", "status"],
      where: { event: { tenantId: staff.tenantId } },
      _count: { _all: true },
    });
    const result: Record<string, InviteSummary> = {};
    for (const g of groups) {
      const s = (result[g.eventId] ??= { total: 0, pending: 0, sent: 0, failed: 0, going: 0, declined: 0 });
      s.total += g._count._all;
      s[g.status.toLowerCase() as Exclude<keyof InviteSummary, "total">] += g._count._all;
    }
    return result;
  }

  /** Кто приглашён и что ответил — список на стойку в день ивента. */
  async list(staff: AuthenticatedStaff, eventId: string) {
    await this.requireEvent(staff, eventId);
    const invites = await this.prisma.eventInvite.findMany({
      where: { eventId },
      include: { guest: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { respondedAt: "desc" },
    });
    return invites.map((i) => ({
      id: i.id,
      status: i.status,
      error: i.error,
      sentAt: i.sentAt,
      respondedAt: i.respondedAt,
      guest: i.guest,
    }));
  }

  /** Один проход очереди. Вне запроса — каждое приглашение уходит от имени своей сети. */
  async processQueue(): Promise<number> {
    const batch = await this.prisma.eventInvite.findMany({
      where: { status: InviteStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: SEND_BATCH,
      include: {
        guest: { select: { fullName: true, phone: true, marketingOptOutAt: true } },
        event: { include: { club: { select: { name: true, city: true, timezone: true } } } },
      },
    });

    let processed = 0;
    for (const invite of batch) {
      const { event, guest } = invite;
      const skip =
        event.startsAt <= new Date()
          ? "Ивент уже начался"
          : !event.isPublished
            ? "Ивент снят с афиши"
            : guest.marketingOptOutAt
              ? "Гость отписался"
              : null;
      if (skip) {
        await this.prisma.eventInvite.update({
          where: { id: invite.id },
          data: { status: InviteStatus.FAILED, error: skip },
        });
        continue;
      }

      const place = event.club
        ? [event.club.name, event.club.city].filter(Boolean).join(", ")
        : "Все клубы сети";
      const result = await this.whatsapp.send(
        event.tenantId,
        guest.phone,
        inviteMessage({
          title: event.title,
          subtitle: event.subtitle,
          startsAt: event.startsAt,
          place,
          prize: event.prize,
          fee: event.fee,
          howToJoin: event.howToJoin,
          timezone: event.club?.timezone ?? "Asia/Almaty",
          guestName: guest.fullName,
        }),
      );

      await this.prisma.eventInvite.update({
        where: { id: invite.id },
        data: result.ok
          ? { status: InviteStatus.SENT, sentAt: new Date(), providerMessageId: result.messageId, error: null }
          : { status: InviteStatus.FAILED, error: result.error },
      });
      if (!result.ok) this.logger.warn(`Приглашение ${invite.id} не ушло: ${result.error}`);

      processed += 1;
      await sleep(SEND_PAUSE_MS);
    }
    return processed;
  }
}
