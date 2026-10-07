import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ClubEvent } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { MAX_ON_SCREEN, visibleSince } from "./afisha.rules.js";
import type { CreateEventDto, UpdateEventDto } from "./afisha.dto.js";

/** Ивент так, как его показывает экран ПК. */
export interface ScreenEvent {
  id: string;
  title: string;
  subtitle: string | null;
  startsAt: Date;
  clubName: string | null;
  prize: string | null;
  fee: string | null;
  seats: string | null;
  howToJoin: string | null;
}

/**
 * Афиша сети: ивенты, которые видны на экранах блокировки всех ПК.
 *
 * Афиша общая на сеть, потому что смысл её — звать гостей одного филиала на
 * события другого.
 */
@Injectable()
export class AfishaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  list(staff: AuthenticatedStaff): Promise<ClubEvent[]> {
    return this.prisma.clubEvent.findMany({
      where: { tenantId: staff.tenantId },
      orderBy: { startsAt: "desc" },
      take: 200,
    });
  }

  async create(staff: AuthenticatedStaff, dto: CreateEventDto): Promise<ClubEvent> {
    const clubId = await this.checkClub(staff, dto.clubId);
    const event = await this.prisma.clubEvent.create({
      data: {
        tenantId: staff.tenantId,
        clubId,
        title: dto.title.trim(),
        subtitle: blankToNull(dto.subtitle),
        startsAt: new Date(dto.startsAt),
        prize: blankToNull(dto.prize),
        fee: blankToNull(dto.fee),
        seats: blankToNull(dto.seats),
        howToJoin: blankToNull(dto.howToJoin),
        isPublished: dto.isPublished ?? true,
      },
    });
    await this.announce(staff.tenantId);
    return event;
  }

  async update(staff: AuthenticatedStaff, eventId: string, dto: UpdateEventDto): Promise<ClubEvent> {
    await this.requireEvent(staff, eventId);
    const clubId = dto.clubId === undefined ? undefined : await this.checkClub(staff, dto.clubId);
    const event = await this.prisma.clubEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.subtitle !== undefined ? { subtitle: blankToNull(dto.subtitle) } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(clubId !== undefined ? { clubId } : {}),
        ...(dto.prize !== undefined ? { prize: blankToNull(dto.prize) } : {}),
        ...(dto.fee !== undefined ? { fee: blankToNull(dto.fee) } : {}),
        ...(dto.seats !== undefined ? { seats: blankToNull(dto.seats) } : {}),
        ...(dto.howToJoin !== undefined ? { howToJoin: blankToNull(dto.howToJoin) } : {}),
        ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
      },
    });
    await this.announce(staff.tenantId);
    return event;
  }

  async remove(staff: AuthenticatedStaff, eventId: string): Promise<void> {
    await this.requireEvent(staff, eventId);
    await this.prisma.clubEvent.delete({ where: { id: eventId } });
    await this.announce(staff.tenantId);
  }

  /** Что показать на экране ПК: ближайшие ивенты сети и подпись сети. */
  async forScreen(computerId: string): Promise<{
    brand: { name: string; slogan: string };
    events: ScreenEvent[];
  }> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: { include: { tenant: true } } },
    });
    if (!computer) throw new NotFoundException("ПК не найден");
    const tenant = computer.club.tenant;

    const events = await this.prisma.clubEvent.findMany({
      where: { tenantId: tenant.id, isPublished: true, startsAt: { gte: visibleSince(new Date()) } },
      include: { club: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
      take: MAX_ON_SCREEN,
    });

    return {
      brand: { name: tenant.name, slogan: tenant.slogan },
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: e.subtitle,
        startsAt: e.startsAt,
        clubName: e.club?.name ?? null,
        prize: e.prize,
        fee: e.fee,
        seats: e.seats,
        howToJoin: e.howToJoin,
      })),
    };
  }

  /** Сказать всем ПК сети, что афиша изменилась — они заберут её сами. */
  async announce(tenantId: string): Promise<void> {
    const clubs = await this.prisma.club.findMany({ where: { tenantId }, select: { id: true } });
    this.bus.emit("afisha.changed", { clubIds: clubs.map((c) => c.id) });
  }

  private async requireEvent(staff: AuthenticatedStaff, eventId: string): Promise<ClubEvent> {
    const event = await this.prisma.clubEvent.findUnique({ where: { id: eventId } });
    if (!event || event.tenantId !== staff.tenantId) throw new NotFoundException("Ивент не найден");
    return event;
  }

  private async checkClub(staff: AuthenticatedStaff, clubId: string | null | undefined): Promise<string | null> {
    if (!clubId) return null;
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club || club.tenantId !== staff.tenantId) throw new BadRequestException("Клуб не найден");
    return club.id;
  }
}

function blankToNull(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
