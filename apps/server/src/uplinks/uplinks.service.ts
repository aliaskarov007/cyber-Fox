import {
  BadRequestException,
  Injectable,
  Logger,
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
import {
  type RouterAccess,
  RouterUnsupportedError,
  setMembership,
} from "./router-client.js";

/** Каналы для экрана игрового ПК: что показать гостю и что выбрано сейчас. */
export interface ComputerChannels {
  enabled: boolean;
  allowMidSession: boolean;
  currentId: string | null;
  channels: Array<{ id: string; name: string; isDefault: boolean }>;
}

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
  private readonly logger = new Logger(UplinksService.name);

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

  // --- Вызовы с игрового ПК (через realtime, без staff-контекста) ---

  /** Запомнить локальный IP машины, если агент его прислал. */
  private async rememberIp(
    computerId: string,
    lanIp: string | undefined,
  ): Promise<void> {
    const ip = lanIp?.trim();
    if (!ip) return;
    await this.prisma.computer.updateMany({
      where: { id: computerId },
      data: { lanIp: ip },
    });
  }

  /** Что показать гостю на экране ПК: доступные каналы и выбранный сейчас. */
  async channelsForComputer(
    computerId: string,
    lanIp?: string,
  ): Promise<ComputerChannels> {
    await this.rememberIp(computerId, lanIp);
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { clubId: true },
    });
    const off: ComputerChannels = {
      enabled: false,
      allowMidSession: true,
      currentId: null,
      channels: [],
    };
    if (!computer) return off;
    const router = await this.prisma.internetRouter.findUnique({
      where: { clubId: computer.clubId },
    });
    if (!router || !router.enabled) return off;
    const channels = await this.prisma.internetChannel.findMany({
      where: { clubId: computer.clubId },
      orderBy: { sortOrder: "asc" },
    });
    if (channels.length < 2) return off;
    const session = await this.prisma.session.findFirst({
      where: { computerId, status: "ACTIVE" },
      select: { internetChannelId: true },
    });
    const current =
      session?.internetChannelId ??
      channels.find((c) => c.isDefault)?.id ??
      channels[0]?.id ??
      null;
    return {
      enabled: true,
      allowMidSession: router.allowMidSession,
      currentId: current,
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        isDefault: c.isDefault,
      })),
    };
  }

  /** Гость выбрал канал на экране ПК: пишем в сессию и правим маршрут на роутере. */
  async selectForComputer(
    computerId: string,
    channelId: string,
    lanIp?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    await this.rememberIp(computerId, lanIp);
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };
    const channel = await this.prisma.internetChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.clubId !== computer.clubId)
      return { ok: false, reason: "Канал не найден" };

    const router = await this.prisma.internetRouter.findUnique({
      where: { clubId: computer.clubId },
    });
    if (!router || !router.enabled)
      return { ok: false, reason: "Выбор провайдера недоступен" };

    const session = await this.prisma.session.findFirst({
      where: { computerId, status: "ACTIVE" },
      select: { id: true },
    });
    if (session && !router.allowMidSession)
      return {
        ok: false,
        reason: "Менять провайдера во время сессии нельзя",
      };

    if (session)
      await this.prisma.session.update({
        where: { id: session.id },
        data: { internetChannelId: channelId },
      });

    const applied = await this.applyOnRouter(
      computer.clubId,
      channelId,
      computer.id,
    );
    if (!applied.ok) return applied;
    return { ok: true };
  }

  /**
   * Применить канал сессии на роутере: IP машины в список выбранного канала,
   * из остальных — убрать. Канал по умолчанию = ни в одном списке.
   * Делается на старте/остановке сессии и при выборе гостем. Не критично:
   * ошибка роутера не должна мешать игре — пишем её в статус и возвращаем reason.
   */
  async applyChannelForSession(
    computerId: string,
    channelId: string | null,
  ): Promise<{ ok: boolean; reason?: string }> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { clubId: true },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };
    return this.applyOnRouter(computer.clubId, channelId, computerId);
  }

  private async applyOnRouter(
    clubId: string,
    channelId: string | null,
    computerIdHint?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const router = await this.prisma.internetRouter.findUnique({
      where: { clubId },
    });
    if (!router || !router.enabled) return { ok: true };

    const channels = await this.prisma.internetChannel.findMany({
      where: { clubId },
    });
    if (channels.length === 0) return { ok: true };

    // Какая машина и её IP. channelId уже проверен вызывающим; тут нужен IP.
    const chosen = channelId
      ? channels.find((c) => c.id === channelId)
      : channels.find((c) => c.isDefault);

    // IP берём по машине выбранной сессии канала или по подсказке.
    const session = computerIdHint
      ? null
      : await this.prisma.session.findFirst({
          where: { clubId, status: "ACTIVE", internetChannelId: channelId },
          select: { computerId: true },
        });
    const computerId = computerIdHint ?? session?.computerId;
    if (!computerId) return { ok: true };
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { lanIp: true },
    });
    const ip = computer?.lanIp ?? undefined;
    if (!ip) {
      await this.noteRouter(clubId, "нет IP машины");
      return { ok: false, reason: "Неизвестен IP машины — агент его сообщит" };
    }

    const access: RouterAccess = {
      host: router.host,
      apiPort: router.apiPort,
      username: router.username,
      password: router.password,
      driver: router.driver,
    };
    try {
      // В списке — только выбранный не-дефолтный канал; из прочих убрать.
      for (const ch of channels) {
        const present =
          chosen !== undefined && !chosen.isDefault && ch.id === chosen.id;
        await setMembership(access, ip, ch.routerMark, present);
      }
      await this.noteRouter(clubId, "ok");
      return { ok: true };
    } catch (error) {
      const reason =
        error instanceof RouterUnsupportedError
          ? error.message
          : (error as Error).message;
      this.logger.warn(`Роутер клуба ${clubId}: ${reason}`);
      await this.noteRouter(clubId, reason);
      return { ok: false, reason };
    }
  }

  private async noteRouter(clubId: string, state: string): Promise<void> {
    await this.prisma.internetRouter.updateMany({
      where: { clubId },
      data: { lastState: state.slice(0, 200), lastCheckAt: new Date() },
    });
  }
}
