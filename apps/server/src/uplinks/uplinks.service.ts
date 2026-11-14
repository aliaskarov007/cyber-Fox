import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { InternetChannel } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  CreateChannelDto,
  SaveRouterDto,
  UpdateChannelDto,
} from "./uplinks.dto.js";

/** Роутер без пароля — то, что уходит в админку. */
export interface PublicRouter {
  configured: boolean;
  host: string | null;
  apiPort: number;
  username: string | null;
  driver: string;
  enabled: boolean;
  allowMidSession: boolean;
  lastState: string | null;
  lastCheckAt: Date | null;
}

export interface PublicInternet {
  router: PublicRouter;
  channels: InternetChannel[];
}

/** Максимум каналов на клуб. Больше двух провайдеров смысла не имеет. */
const MAX_CHANNELS = 2;

@Injectable()
export class UplinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
  ) {}

  async get(
    staff: AuthenticatedStaff,
    clubId: string,
  ): Promise<PublicInternet> {
    await this.access.requireClub(staff, clubId);
    const router = await this.prisma.internetRouter.findUnique({
      where: { clubId },
    });
    const channels = await this.prisma.internetChannel.findMany({
      where: { clubId },
      orderBy: { sortOrder: "asc" },
    });
    return {
      router: {
        configured: router !== null,
        host: router?.host ?? null,
        apiPort: router?.apiPort ?? 0,
        username: router?.username ?? null,
        driver: router?.driver ?? "ROS7",
        enabled: router?.enabled ?? false,
        allowMidSession: router?.allowMidSession ?? true,
        lastState: router?.lastState ?? null,
        lastCheckAt: router?.lastCheckAt ?? null,
      },
      channels,
    };
  }

  async saveRouter(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: SaveRouterDto,
  ): Promise<PublicInternet> {
    await this.access.requireClub(staff, clubId);
    const existing = await this.prisma.internetRouter.findUnique({
      where: { clubId },
    });
    // Пустой пароль при сохранении — оставить прежний (как у ключей Kaspi).
    const password = dto.password?.trim() || existing?.password;
    if (!password)
      throw new BadRequestException("Укажите пароль API-пользователя роутера");

    const data = {
      host: dto.host.trim(),
      apiPort: dto.apiPort ?? 0,
      username: dto.username.trim(),
      password,
      driver: dto.driver ?? existing?.driver ?? "ROS7",
      enabled: dto.enabled ?? existing?.enabled ?? true,
      allowMidSession: dto.allowMidSession ?? existing?.allowMidSession ?? true,
    };
    await this.prisma.internetRouter.upsert({
      where: { clubId },
      create: { clubId, tenantId: staff.tenantId, ...data },
      update: data,
    });
    return this.get(staff, clubId);
  }

  async deleteRouter(
    staff: AuthenticatedStaff,
    clubId: string,
  ): Promise<PublicInternet> {
    await this.access.requireClub(staff, clubId);
    await this.prisma.internetRouter.deleteMany({ where: { clubId } });
    return this.get(staff, clubId);
  }

  async addChannel(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateChannelDto,
  ): Promise<PublicInternet> {
    await this.access.requireClub(staff, clubId);
    const count = await this.prisma.internetChannel.count({
      where: { clubId },
    });
    if (count >= MAX_CHANNELS)
      throw new BadRequestException(
        `Больше ${MAX_CHANNELS} каналов на клуб добавить нельзя`,
      );
    // Первый канал всегда по умолчанию; иначе — как попросили.
    const isDefault = count === 0 ? true : (dto.isDefault ?? false);
    if (isDefault)
      await this.prisma.internetChannel.updateMany({
        where: { clubId },
        data: { isDefault: false },
      });
    await this.prisma.internetChannel.create({
      data: {
        clubId,
        tenantId: staff.tenantId,
        name: dto.name.trim(),
        routerMark: dto.routerMark.trim(),
        isDefault,
        sortOrder: count,
      },
    });
    return this.get(staff, clubId);
  }

  async updateChannel(
    staff: AuthenticatedStaff,
    clubId: string,
    channelId: string,
    dto: UpdateChannelDto,
  ): Promise<PublicInternet> {
    await this.access.requireClub(staff, clubId);
    const channel = await this.prisma.internetChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.clubId !== clubId)
      throw new NotFoundException("Канал не найден");

    // Канал по умолчанию — единственный: назначая этот, снимаем остальных.
    if (dto.isDefault === true)
      await this.prisma.internetChannel.updateMany({
        where: { clubId, id: { not: channelId } },
        data: { isDefault: false },
      });
    await this.prisma.internetChannel.update({
      where: { id: channelId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.routerMark === undefined
          ? {}
          : { routerMark: dto.routerMark.trim() }),
        ...(dto.isDefault === undefined ? {} : { isDefault: dto.isDefault }),
        ...(dto.sortOrder === undefined ? {} : { sortOrder: dto.sortOrder }),
      },
    });
    return this.get(staff, clubId);
  }

  async deleteChannel(
    staff: AuthenticatedStaff,
    clubId: string,
    channelId: string,
  ): Promise<PublicInternet> {
    await this.access.requireClub(staff, clubId);
    const channel = await this.prisma.internetChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.clubId !== clubId)
      throw new NotFoundException("Канал не найден");
    await this.prisma.internetChannel.delete({ where: { id: channelId } });
    // Если удалили канал по умолчанию — назначаем первый из оставшихся.
    if (channel.isDefault) {
      const next = await this.prisma.internetChannel.findFirst({
        where: { clubId },
        orderBy: { sortOrder: "asc" },
      });
      if (next)
        await this.prisma.internetChannel.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
    }
    return this.get(staff, clubId);
  }
}
