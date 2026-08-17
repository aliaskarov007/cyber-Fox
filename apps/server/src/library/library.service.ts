import { Injectable, NotFoundException } from "@nestjs/common";
import type { ClubApp } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import type { CreateAppDto, UpdateAppDto } from "./library.dto.js";

/**
 * Каталог игр клуба.
 *
 * Правка каталога сразу уходит агентам: владелец добавляет игру в кассе и видит
 * её на машинах зала, не трогая образ и не перезагружая зал. Ради этого каждое
 * изменение поднимает событие, а не ждёт, пока агент переспросит сам.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly bus: RealtimeBus,
  ) {}

  async list(staff: AuthenticatedStaff, clubId: string): Promise<ClubApp[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.clubApp.findMany({
      where: { clubId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  /**
   * Что видит машина конкретной зоны: общие игры клуба плюс игры своей зоны.
   * Выключенные не отдаются вовсе — прятать их на стороне агента значило бы
   * рассылать по залу то, что решили не показывать.
   */
  async forZone(clubId: string, zoneId: string): Promise<ClubApp[]> {
    return this.prisma.clubApp.findMany({
      where: { clubId, isActive: true, OR: [{ zoneId: null }, { zoneId }] },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async create(staff: AuthenticatedStaff, clubId: string, dto: CreateAppDto): Promise<ClubApp> {
    await this.access.requireClub(staff, clubId);
    const app = await this.prisma.clubApp.create({
      data: {
        clubId,
        name: dto.name.trim(),
        category: dto.category?.trim() || null,
        kind: dto.kind ?? "EXECUTABLE",
        target: dto.target.trim(),
        args: dto.args ?? [],
        coverUrl: dto.coverUrl?.trim() || null,
        zoneId: dto.zoneId ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    this.bus.emit("library.changed", { clubId });
    return app;
  }

  async update(
    staff: AuthenticatedStaff,
    clubId: string,
    appId: string,
    dto: UpdateAppDto,
  ): Promise<ClubApp> {
    await this.access.requireClub(staff, clubId);
    const existing = await this.prisma.clubApp.findUnique({ where: { id: appId } });
    if (!existing || existing.clubId !== clubId) throw new NotFoundException("Игра не найдена");

    const app = await this.prisma.clubApp.update({
      where: { id: appId },
      data: {
        ...dto,
        name: dto.name?.trim(),
        target: dto.target?.trim(),
        // Пустая строка в кассе значит «убрать», а не «оставить как было».
        category: dto.category === undefined ? undefined : dto.category.trim() || null,
        coverUrl: dto.coverUrl === undefined ? undefined : dto.coverUrl.trim() || null,
      },
    });
    this.bus.emit("library.changed", { clubId });
    return app;
  }

  /**
   * Удаление настоящее, в отличие от тарифов и товаров: игра не участвует ни в
   * одном расчёте и ни в одном закрытом чеке, стирать нечего.
   */
  async remove(staff: AuthenticatedStaff, clubId: string, appId: string): Promise<{ ok: true }> {
    await this.access.requireClub(staff, clubId);
    const existing = await this.prisma.clubApp.findUnique({ where: { id: appId } });
    if (!existing || existing.clubId !== clubId) throw new NotFoundException("Игра не найдена");

    await this.prisma.clubApp.delete({ where: { id: appId } });
    this.bus.emit("library.changed", { clubId });
    return { ok: true };
  }
}
