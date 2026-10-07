import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { type Event, EventAudience, InviteStatus, type Prisma } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsAppService } from "../whatsapp/whatsapp.service.js";
import { inviteMessage } from "../whatsapp/whatsapp.rules.js";
import type { CreateEventDto } from "./events.dto.js";
import { type InviteSummary, SEND_BATCH, SEND_PAUSE_MS, sendBlocker, summarizeInvites } from "./events.rules.js";

export interface EventWithStats extends Event {
  invites: InviteSummary;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ивенты и приглашения.
 *
 * Гость общий для всей сети, поэтому ивент одного зала можно показать гостям
 * всех залов: тот, кто играет в соседнем филиале, узнает о турнире здесь.
 * Приглашения уходят только на подтверждённые номера и не тем, кто отписался.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private async requireEvent(staff: AuthenticatedStaff, clubId: string, eventId: string): Promise<Event> {
    await this.access.requireClub(staff, clubId);
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.clubId !== clubId || event.tenantId !== staff.tenantId) {
      throw new NotFoundException("Ивент не найден");
    }
    return event;
  }

  /** Кому уйдут приглашения: подтверждённый номер, без отписки, при CLUB — играл в этом зале. */
  private audienceWhere(tenantId: string, clubId: string, audience: EventAudience): Prisma.GuestWhereInput {
    return {
      tenantId,
      phoneVerifiedAt: { not: null },
      invitesOptOutAt: null,
      ...(audience === EventAudience.CLUB ? { sessions: { some: { clubId } } } : {}),
    };
  }

  async list(staff: AuthenticatedStaff, clubId: string): Promise<EventWithStats[]> {
    await this.access.requireClub(staff, clubId);
    const events = await this.prisma.event.findMany({
      where: { clubId, tenantId: staff.tenantId },
      orderBy: { startsAt: "desc" },
      take: 50,
    });
    if (events.length === 0) return [];

    const groups = await this.prisma.eventInvite.groupBy({
      by: ["eventId", "status"],
      where: { eventId: { in: events.map((e) => e.id) } },
      _count: { _all: true },
    });

    return events.map((event) => ({
      ...event,
      invites: summarizeInvites(
        groups
          .filter((g) => g.eventId === event.id)
          .map((g) => ({ status: g.status, count: g._count._all })),
      ),
    }));
  }

  async create(staff: AuthenticatedStaff, clubId: string, dto: CreateEventDto): Promise<Event> {
    await this.access.requireClub(staff, clubId);
    const startsAt = new Date(dto.startsAt);
    if (startsAt.getTime() <= Date.now()) throw new BadRequestException("Начало ивента должно быть в будущем");

    return this.prisma.event.create({
      data: {
        tenantId: staff.tenantId,
        clubId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        startsAt,
        audience: dto.audience ?? EventAudience.NETWORK,
        createdById: staff.id,
      },
    });
  }

  /** Сколько гостей получит приглашение — показывается до нажатия «Разослать». */
  async audienceSize(
    staff: AuthenticatedStaff,
    clubId: string,
    audience: EventAudience,
  ): Promise<{ guests: number; unverified: number }> {
    await this.access.requireClub(staff, clubId);
    const [guests, unverified] = await Promise.all([
      this.prisma.guest.count({ where: this.audienceWhere(staff.tenantId, clubId, audience) }),
      // Подсказка администратору: столько гостей пропустит рассылка, пока не подтвердят номер.
      this.prisma.guest.count({
        where: {
          tenantId: staff.tenantId,
          phoneVerifiedAt: null,
          ...(audience === EventAudience.CLUB ? { sessions: { some: { clubId } } } : {}),
        },
      }),
    ]);
    return { guests, unverified };
  }

  /**
   * Ставит приглашения в очередь. Отправляет их фоновый проход: сотня
   * сообщений с паузами — это минуты, кассовый экран столько не ждёт.
   * Повторная рассылка дошлёт только тем, кто появился после первой.
   */
  async send(staff: AuthenticatedStaff, clubId: string, eventId: string): Promise<{ queued: number }> {
    const event = await this.requireEvent(staff, clubId, eventId);
    const blocker = sendBlocker(event, new Date());
    if (blocker) throw new BadRequestException(blocker);

    await this.whatsapp.requireChannel(staff.tenantId);

    const guests = await this.prisma.guest.findMany({
      where: this.audienceWhere(staff.tenantId, clubId, event.audience),
      select: { id: true },
    });

    const { count } = await this.prisma.eventInvite.createMany({
      data: guests.map((g) => ({ eventId: event.id, guestId: g.id })),
      skipDuplicates: true,
    });

    await this.prisma.event.update({ where: { id: event.id }, data: { sentAt: new Date() } });
    return { queued: count };
  }

  async cancel(staff: AuthenticatedStaff, clubId: string, eventId: string): Promise<Event> {
    const event = await this.requireEvent(staff, clubId, eventId);
    if (event.canceledAt) return event;

    // Неотправленные приглашения на отменённый ивент уходить не должны.
    await this.prisma.eventInvite.deleteMany({ where: { eventId, status: InviteStatus.PENDING } });
    return this.prisma.event.update({ where: { id: eventId }, data: { canceledAt: new Date() } });
  }

  /** Кто приглашён и что ответил: список на стойку в день ивента. */
  async invites(staff: AuthenticatedStaff, clubId: string, eventId: string) {
    await this.requireEvent(staff, clubId, eventId);
    const invites = await this.prisma.eventInvite.findMany({
      where: { eventId },
      include: { guest: { select: { id: true, fullName: true, phone: true } } },
      orderBy: [{ status: "asc" }, { respondedAt: "desc" }],
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

  /**
   * Один проход очереди рассылки. Вызывается воркером вне запроса — сети у
   * этого пути нет, поэтому каждое приглашение отправляется от имени своей.
   */
  async processQueue(): Promise<number> {
    const batch = await this.prisma.eventInvite.findMany({
      where: { status: InviteStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: SEND_BATCH,
      include: {
        guest: { select: { fullName: true, phone: true, invitesOptOutAt: true } },
        event: { include: { club: { select: { name: true, city: true, timezone: true } } } },
      },
    });

    let processed = 0;
    for (const invite of batch) {
      const { event, guest } = invite;
      const blocker = sendBlocker(event, new Date());
      const skip = blocker ?? (guest.invitesOptOutAt ? "Гость отписался от приглашений" : null);

      if (skip) {
        await this.prisma.eventInvite.update({
          where: { id: invite.id },
          data: { status: InviteStatus.FAILED, error: skip },
        });
        continue;
      }

      const result = await this.whatsapp.send(
        event.tenantId,
        guest.phone,
        inviteMessage({
          title: event.title,
          description: event.description,
          startsAt: event.startsAt,
          clubName: event.club.name,
          clubCity: event.club.city,
          timezone: event.club.timezone,
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
