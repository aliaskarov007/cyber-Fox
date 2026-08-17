import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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
    await this.requireOwnZone(clubId, dto.zoneId);
    const app = await this.named(() => this.prisma.clubApp.create({
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
    }));
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
    await this.requireOwnZone(clubId, dto.zoneId);

    const app = await this.named(() => this.prisma.clubApp.update({
      where: { id: appId },
      data: {
        ...dto,
        name: dto.name?.trim(),
        target: dto.target?.trim(),
        // Пустая строка в кассе значит «убрать», а не «оставить как было».
        category: dto.category === undefined ? undefined : dto.category.trim() || null,
        coverUrl: dto.coverUrl === undefined ? undefined : dto.coverUrl.trim() || null,
      },
    }));
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

  /*
   * Название игры в клубе уникально. Без перехвата совпадение выглядело бы
   * пятисотой ошибкой, и владелец, переименовывая игру в уже занятое имя, видел
   * бы «что-то пошло не так» вместо причины.
   */
  private async named<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException("Игра с таким названием в клубе уже есть");
      }
      throw error;
    }
  }

  /*
   * Чужая зона внешним ключом не отсекается: он проверяет лишь существование
   * зоны, а не то, что она из этого клуба. Игра с чужой зоной не показалась бы
   * никому — forZone сначала фильтрует по клубу, — и владелец искал бы пропажу
   * в оболочке, а не в поле, которое сам заполнил.
   */
  private async requireOwnZone(clubId: string, zoneId: string | null | undefined): Promise<void> {
    if (!zoneId) return;
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.clubId !== clubId) throw new NotFoundException("Зона не найдена");
  }
}
