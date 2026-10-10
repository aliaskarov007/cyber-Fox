import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import type { CreateSlideDto, UpdateSlideDto } from "./screen.dto.js";
import {
  EVENTS_AHEAD_DAYS,
  ImpressionThrottle,
  type ScreenSlideView,
  buildCarousel,
  slideBlocker,
} from "./screen.rules.js";

export interface GuestScreen {
  clubName: string;
  slogan: string | null;
  slides: ScreenSlideView[];
}

/**
 * Экран блокировки игровых ПК: название и слоган клуба, карусель с ближайшими
 * турнирами и рекламой партнёров.
 *
 * Турниры не заводятся здесь второй раз — они берутся из «Ивентов». Слайды —
 * для всего остального: партнёр, акция бара, ночной тариф.
 */
@Injectable()
export class ScreenService {
  private readonly throttle = new ImpressionThrottle();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Слайды зала для настроек: свои и общие на сеть, со счётчиком показов. */
  async list(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);
    const slides = await this.prisma.screenSlide.findMany({
      where: { tenantId: staff.tenantId, OR: [{ clubId }, { clubId: null }] },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 100,
    });
    return slides.map((s) => ({ ...s, networkWide: s.clubId === null }));
  }

  async create(staff: AuthenticatedStaff, clubId: string, dto: CreateSlideDto) {
    await this.access.requireClub(staff, clubId);
    if (dto.networkWide && staff.role !== StaffRole.OWNER) {
      throw new ForbiddenException("Слайд для всей сети добавляет владелец");
    }
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const blocker = slideBlocker({ title: dto.title, startsAt, endsAt });
    if (blocker) throw new BadRequestException(blocker);

    const slide = await this.prisma.screenSlide.create({
      data: {
        tenantId: staff.tenantId,
        clubId: dto.networkWide ? null : clubId,
        title: dto.title.trim(),
        text: dto.text?.trim() || null,
        imageUrl: dto.imageUrl ?? null,
        partner: dto.partner?.trim() || null,
        startsAt,
        endsAt,
        sortOrder: dto.sortOrder ?? 0,
        createdById: staff.id,
      },
    });
    await this.announce(staff.tenantId, slide.clubId);
    return slide;
  }

  async update(staff: AuthenticatedStaff, clubId: string, slideId: string, dto: UpdateSlideDto) {
    const slide = await this.requireSlide(staff, clubId, slideId);
    const updated = await this.prisma.screenSlide.update({
      where: { id: slide.id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.announce(staff.tenantId, slide.clubId);
    return updated;
  }

  async remove(staff: AuthenticatedStaff, clubId: string, slideId: string) {
    const slide = await this.requireSlide(staff, clubId, slideId);
    await this.prisma.screenSlide.delete({ where: { id: slide.id } });
    await this.announce(staff.tenantId, slide.clubId);
    return { ok: true };
  }

  /** Что показать на экране блокировки машины этого зала. */
  async forClub(clubId: string): Promise<GuestScreen | null> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, tenantId: true, name: true, slogan: true },
    });
    if (!club) return null;

    const now = new Date();
    const horizon = new Date(now.getTime() + EVENTS_AHEAD_DAYS * 24 * 60 * 60 * 1000);
    const [events, ads] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          tenantId: club.tenantId,
          canceledAt: null,
          startsAt: { gt: now, lte: horizon },
          // Турнир соседнего зала сети зовёт сюда, только если приглашает всю сеть.
          OR: [{ clubId: club.id }, { audience: "NETWORK" }],
        },
        include: { club: { select: { name: true } } },
        orderBy: { startsAt: "asc" },
        take: 20,
      }),
      this.prisma.screenSlide.findMany({
        where: { tenantId: club.tenantId, isActive: true, OR: [{ clubId: club.id }, { clubId: null }] },
        take: 50,
      }),
    ]);

    return {
      clubName: club.name,
      slogan: club.slogan,
      slides: buildCarousel(
        events.map((e) => ({ ...e, clubName: e.club.name })),
        ads,
        club.id,
        now,
      ),
    };
  }

  /** Слайд побывал на экране машины. */
  async impression(computerId: string, clubId: string, slideId: string): Promise<void> {
    if (!this.throttle.allow(computerId, slideId)) return;
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { tenantId: true } });
    if (!club) return;
    // updateMany — чтобы машина не накручивала слайды чужого зала или чужой сети.
    await this.prisma.screenSlide.updateMany({
      where: { id: slideId, tenantId: club.tenantId, OR: [{ clubId }, { clubId: null }] },
      data: { impressions: { increment: 1 } },
    });
  }

  /** Сказать машинам зала (или всей сети), что экран поменялся. */
  async announce(tenantId: string, clubId: string | null): Promise<void> {
    if (clubId) {
      this.bus.emit("screen.changed", { clubIds: [clubId] });
      return;
    }
    const clubs = await this.prisma.club.findMany({ where: { tenantId }, select: { id: true } });
    this.bus.emit("screen.changed", { clubIds: clubs.map((c) => c.id) });
  }

  private async requireSlide(staff: AuthenticatedStaff, clubId: string, slideId: string) {
    await this.access.requireClub(staff, clubId);
    const slide = await this.prisma.screenSlide.findUnique({ where: { id: slideId } });
    if (!slide || slide.tenantId !== staff.tenantId || (slide.clubId !== null && slide.clubId !== clubId)) {
      throw new NotFoundException("Слайд не найден");
    }
    if (slide.clubId === null && staff.role !== StaffRole.OWNER) {
      throw new ForbiddenException("Слайд для всей сети меняет владелец");
    }
    return slide;
  }
}
