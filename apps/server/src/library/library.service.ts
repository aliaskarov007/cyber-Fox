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

  /** Что этот гость отметил своим: отмеченные встают в оболочке первыми. */
  async favouriteIds(guestId: string): Promise<string[]> {
    const rows = await this.prisma.guestFavourite.findMany({
      where: { guestId },
      select: { appId: true },
    });
    return rows.map((row) => row.appId);
  }

  /**
   * Отметить или снять отметку.
   *
   * Принадлежность игры клубу проверяется здесь же: пометить чужую запись
   * гость не должен, даже если идентификатор откуда-то узнал.
   */
  async setFavourite(
    clubId: string,
    guestId: string,
    appId: string,
    on: boolean,
  ): Promise<{ ok: true }> {
    const app = await this.prisma.clubApp.findFirst({ where: { id: appId, clubId } });
    if (!app) throw new NotFoundException("Игра не найдена");

    if (on) {
      await this.prisma.guestFavourite.upsert({
        where: { guestId_appId: { guestId, appId } },
        update: {},
        create: { guestId, appId },
      });
    } else {
      await this.prisma.guestFavourite.deleteMany({ where: { guestId, appId } });
    }
    return { ok: true };
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
        section: dto.section ?? "GAME",
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

  /**
   * Что агент нашёл на машине.
   *
   * Записывается в отдельный список, а не сразу на полки: на машинах зала
   * стоит и то, что гостю показывать незачем. Уже добавленное в каталог
   * пропускается — иначе владелец каждый раз разгребал бы одно и то же.
   */
  async recordScan(
    clubId: string,
    computerId: string,
    items: Array<{ name: string; target: string; coverUrl?: string | null }>,
  ): Promise<{ saved: number }> {
    if (items.length === 0) return { saved: 0 };

    const known = await this.prisma.clubApp.findMany({
      where: { clubId, target: { in: items.map((item) => item.target) } },
      select: { target: true },
    });
    const inCatalog = new Set(known.map((app) => app.target));

    const fresh = items.filter((item) => !inCatalog.has(item.target));
    for (const item of fresh) {
      await this.prisma.appSuggestion.upsert({
        where: { clubId_target: { clubId, target: item.target } },
        // Повторный обход обновляет время: по нему видно, что игра ещё стоит.
        update: { name: item.name, coverUrl: item.coverUrl ?? null, computerId, seenAt: new Date() },
        create: {
          clubId,
          computerId,
          name: item.name,
          target: item.target,
          coverUrl: item.coverUrl ?? null,
          kind: "URI",
        },
      });
    }

    return { saved: fresh.length };
  }

  async suggestions(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);
    return this.prisma.appSuggestion.findMany({ where: { clubId }, orderBy: { name: "asc" } });
  }

  /** Перенос найденного на полки: владелец отобрал, что показывать гостю. */
  async accept(staff: AuthenticatedStaff, clubId: string, ids: string[]): Promise<{ added: number }> {
    await this.access.requireClub(staff, clubId);
    const chosen = await this.prisma.appSuggestion.findMany({
      where: { id: { in: ids }, clubId },
    });

    let added = 0;
    for (const item of chosen) {
      try {
        await this.prisma.clubApp.create({
          data: {
            clubId,
            name: item.name,
            kind: item.kind,
            target: item.target,
            coverUrl: item.coverUrl,
          },
        });
        added += 1;
      } catch (error) {
        // Игра с таким названием уже на полке: пропускаем, но предложение
        // всё равно убираем — оно своё дело сделало.
        if ((error as { code?: string }).code !== "P2002") throw error;
      }
    }

    await this.prisma.appSuggestion.deleteMany({ where: { id: { in: chosen.map((i) => i.id) }, clubId } });
    if (added > 0) this.bus.emit("library.changed", { clubId });
    return { added };
  }

  /** Отказ: программа найдена, но гостю не нужна. */
  async dismiss(staff: AuthenticatedStaff, clubId: string, id: string): Promise<{ ok: true }> {
    await this.access.requireClub(staff, clubId);
    await this.prisma.appSuggestion.deleteMany({ where: { id, clubId } });
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
