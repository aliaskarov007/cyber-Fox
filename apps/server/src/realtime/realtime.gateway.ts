import { Logger, type OnModuleInit } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import type { JwtPayload } from "../auth/auth.types.js";
import type { OfflineOperationInput } from "../offline/offline.service.js";
import { OfflineService } from "../offline/offline.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { AgentService } from "./agent.service.js";
import { LibraryService } from "../library/library.service.js";
import { RealtimeBus } from "./realtime.bus.js";

/** Комната кассовых экранов клуба. */
const adminRoom = (clubId: string): string => `admin:${clubId}`;
/** Комната конкретного игрового ПК. */
const agentRoom = (computerId: string): string => `agent:${computerId}`;
/*
 * Комната всех машин клуба. Нужна для того, что касается зала целиком —
 * например правки каталога игр: рассылать её по одной машине значит знать
 * сорок идентификаторов там, где хватает одного клуба.
 */
const clubAgentsRoom = (clubId: string): string => `agents:${clubId}`;

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly bus: RealtimeBus,
    private readonly agents: AgentService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly offline: OfflineService,
    private readonly sessions: SessionsService,
    private readonly library: LibraryService,
  ) {}

  onModuleInit(): void {
    // События движка сессий уходят и админам зала, и самому ПК: админ видит
    // карту зала, гость — свой таймер.
    this.bus.on("session.started", (e) => {
      this.server.to(adminRoom(e.clubId)).emit("session.started", e);
      this.server.to(agentRoom(e.computerId)).emit("session.started", e);
    });
    this.bus.on("session.stopped", (e) => {
      this.server.to(adminRoom(e.clubId)).emit("session.stopped", e);
      this.server.to(agentRoom(e.computerId)).emit("lock", e);
    });
    this.bus.on("session.tick", (e) => {
      this.server.to(adminRoom(e.clubId)).emit("session.tick", e);
      this.server.to(agentRoom(e.computerId)).emit("session.tick", e);
    });
    this.bus.on("session.switched", (e) => {
      this.server.to(adminRoom(e.clubId)).emit("session.switched", e);
      this.server.to(agentRoom(e.computerId)).emit("session.switched", e);
    });
    this.bus.on("computer.status", (e) => {
      this.server.to(adminRoom(e.clubId)).emit("computer.status", e);
    });
    this.bus.on("staff.called", (e) => {
      this.server.to(adminRoom(e.clubId)).emit("staff.called", e);
    });
    /*
     * Каталог изменился — машинам уходит только сигнал. Список они забирают
     * сами: у зон он разный, и рассылать всем всё значило бы слать VIP-полку
     * туда, где её показывать не собирались.
     */
    this.bus.on("library.changed", (e) => {
      this.server.to(clubAgentsRoom(e.clubId)).emit("library.changed", {});
    });
  }

  /**
   * Соединение опознаётся при подключении: кассовый экран — по токену сотрудника,
   * агент — по коду привязки машины.
   */
  async handleConnection(client: Socket): Promise<void> {
    const { token, pairingToken, enrollmentKey, macAddress, hostname } = client.handshake.auth as {
      token?: string;
      pairingToken?: string;
      enrollmentKey?: string;
      macAddress?: string;
      hostname?: string;
    };

    try {
      /*
       * Бездисковый зал: код привязки в общий образ не положишь, поэтому машина
       * предъявляет ключ клуба и свой MAC. Ветка идёт первой — если в образе
       * лежит ключ, он и есть способ подключения.
       */
      if (enrollmentKey) {
        const computer = await this.agents
          .enroll(enrollmentKey, macAddress ?? "", hostname ?? "")
          .catch((error: Error) => {
            client.emit("pair.rejected", { reason: error.message });
            throw error;
          });
        await this.attachAgent(client, computer);
        return;
      }

      if (pairingToken) {
        /*
         * Ошибку привязки объясняем агенту до разрыва соединения. Молчаливый
         * disconnect выглядит на игровом ПК как «сервер недоступен», и админ
         * при установке ищет проблему в сети, а не в опечатке в коде.
         */
        const computer = await this.agents
          .pair(pairingToken, hostname ?? "unknown")
          .catch((error: Error) => {
            client.emit("pair.rejected", { reason: error.message });
            throw error;
          });
        await this.attachAgent(client, computer);
        return;
      }

      if (token) {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        const clubs = await this.prisma.club.findMany({
          where: {
            tenantId: payload.tenantId,
            ...(payload.clubId ? { id: payload.clubId } : {}),
          },
          select: { id: true },
        });
        client.data.staffId = payload.sub;
        for (const club of clubs) await client.join(adminRoom(club.id));
        client.emit("ready", { clubIds: clubs.map((c) => c.id) });
        return;
      }

      client.disconnect(true);
    } catch (error) {
      this.logger.warn(`Соединение отклонено: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  /**
   * Общая часть обоих способов подключения агента: по коду привязки и по
   * ключу бездискового зала. Различается только опознание машины — дальше и
   * комната, и восстановление сессии одинаковы.
   */
  private async attachAgent(
    client: Socket,
    computer: {
      id: string;
      clubId: string;
      zoneId: string;
      name: string;
      zone: { name: string };
      club: { name: string };
    },
  ): Promise<void> {
    client.data.computerId = computer.id;
    client.data.clubId = computer.clubId;
    client.data.zoneId = computer.zoneId;
    await client.join(agentRoom(computer.id));
    await client.join(clubAgentsRoom(computer.clubId));
    client.emit("paired", {
      computerId: computer.id,
      computerName: computer.name,
      zoneName: computer.zone.name,
      clubName: computer.club.name,
    });

    // Агент мог перезапуститься посреди оплаченной игры: отдаём состояние
    // сразу, иначе он до минуты держит блокировку поверх чужой сессии.
    const activeSessionId = await this.sessions.activeSessionFor(computer.id);
    if (activeSessionId) {
      // Время молчания не начисляем: оно не подтверждено. Реально отыгранное
      // придёт отдельным отчётом агента.
      await this.sessions.resumeAfterSilence(activeSessionId);
      const snapshot = await this.sessions.sessionSnapshot(activeSessionId);
      if (snapshot) client.emit("session.tick", snapshot);
    }
  }

  @SubscribeMessage("heartbeat")
  async heartbeat(@ConnectedSocket() client: Socket): Promise<void> {
    const computerId = client.data.computerId as string | undefined;
    if (computerId) await this.agents.heartbeat(computerId);
  }

  @SubscribeMessage("guest.login")
  async guestLogin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { phone: string; pin: string },
  ) {
    const computerId = client.data.computerId as string | undefined;
    if (!computerId) return { ok: false, reason: "ПК не опознан" };
    return this.agents.guestLogin(computerId, body.phone, body.pin);
  }

  @SubscribeMessage("session.start")
  async startSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { guestId: string; tariffId?: string },
  ) {
    const computerId = client.data.computerId as string | undefined;
    if (!computerId) return { ok: false, reason: "ПК не опознан" };
    try {
      const session = await this.agents.startByGuest(computerId, body.guestId, body.tariffId ?? null);
      return { ok: true, sessionId: session.id };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  @SubscribeMessage("session.stop")
  async stopSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId: string },
  ) {
    const computerId = client.data.computerId as string | undefined;
    if (!computerId) return { ok: false, reason: "ПК не опознан" };
    try {
      await this.agents.stopByGuest(computerId, body.sessionId);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  /**
   * Досылка минут, отыгранных без связи с облаком.
   *
   * Приходит сразу после восстановления соединения. Идемпотентна по UUID:
   * обрыв во время отправки не должен списать минуты дважды.
   */
  @SubscribeMessage("offline.replay")
  async replayOffline(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { operations: OfflineOperationInput[] },
  ) {
    const computerId = client.data.computerId as string | undefined;
    if (!computerId) return { ok: false, reason: "ПК не опознан" };
    try {
      const result = await this.offline.ingest(computerId, body.operations ?? []);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  /**
   * Каталог игр для этой машины: общие игры клуба плюс игры её зоны.
   *
   * Запрашивает агент — при подключении и по сигналу об изменении. Так каталог
   * не рассылается тем, кто его сейчас не показывает, и приходит свежим ровно
   * тогда, когда оболочка собирается его рисовать.
   */
  @SubscribeMessage("library.fetch")
  async fetchLibrary(@ConnectedSocket() client: Socket) {
    const clubId = client.data.clubId as string | undefined;
    const zoneId = client.data.zoneId as string | undefined;
    if (!clubId || !zoneId) return { ok: false, apps: [] };

    const apps = await this.library.forZone(clubId, zoneId);

    /*
     * Отметки принадлежат гостю, а не машине: он садится за разные ПК, и свои
     * игры должен видеть первыми на любом. Без гостя — анонимная посадка —
     * отметок нет вовсе.
     */
    const guestId = await this.currentGuest(client);
    const favourites = guestId ? await this.library.favouriteIds(guestId) : [];

    return {
      ok: true,
      favourites,
      apps: apps.map((app) => ({
        id: app.id,
        name: app.name,
        category: app.category,
        section: app.section,
        kind: app.kind,
        target: app.target,
        args: app.args,
        coverUrl: app.coverUrl,
      })),
    };
  }

  /**
   * Что стоит на машине. Присылает агент после подключения.
   *
   * Заводить каталог руками по сорок игр никто не станет, а машина знает про
   * себя всё сама. Найденное не попадает на полки: владелец отбирает из списка,
   * потому что на машинах зала стоит и то, что гостю показывать незачем.
   */
  @SubscribeMessage("library.scan")
  async recordScan(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { items?: Array<{ name: string; target: string; coverUrl?: string | null }> },
  ) {
    const clubId = client.data.clubId as string | undefined;
    const computerId = client.data.computerId as string | undefined;
    if (!clubId || !computerId) return { ok: false, saved: 0 };

    const result = await this.library.recordScan(clubId, computerId, body.items ?? []);
    return { ok: true, ...result };
  }

  /** Гость отметил игру своей или снял отметку. */
  @SubscribeMessage("library.favourite")
  async setFavourite(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { appId: string; on: boolean },
  ) {
    const clubId = client.data.clubId as string | undefined;
    const guestId = await this.currentGuest(client);
    if (!clubId || !guestId) return { ok: false };

    await this.library.setFavourite(clubId, guestId, body.appId, body.on);
    return { ok: true };
  }

  /** Гость за этой машиной прямо сейчас, если сессия его, а не анонимная. */
  private async currentGuest(client: Socket): Promise<string | null> {
    const computerId = client.data.computerId as string | undefined;
    if (!computerId) return null;

    const session = await this.prisma.session.findFirst({
      where: { computerId, status: "ACTIVE" },
      select: { guestId: true },
    });
    return session?.guestId ?? null;
  }

  @SubscribeMessage("staff.call")
  async callStaff(@ConnectedSocket() client: Socket): Promise<{ ok: boolean }> {
    const computerId = client.data.computerId as string | undefined;
    const clubId = client.data.clubId as string | undefined;
    if (!computerId || !clubId) return { ok: false };

    const session = await this.prisma.session.findFirst({
      where: { computerId, status: "ACTIVE" },
      select: { id: true },
    });
    this.bus.emit("staff.called", { clubId, computerId, sessionId: session?.id ?? null });
    return { ok: true };
  }
}
