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
import { PrismaService } from "../prisma/prisma.service.js";
import { AgentService } from "./agent.service.js";
import { RealtimeBus } from "./realtime.bus.js";

/** Комната кассовых экранов клуба. */
const adminRoom = (clubId: string): string => `admin:${clubId}`;
/** Комната конкретного игрового ПК. */
const agentRoom = (computerId: string): string => `agent:${computerId}`;

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
  }

  /**
   * Соединение опознаётся при подключении: кассовый экран — по токену сотрудника,
   * агент — по коду привязки машины.
   */
  async handleConnection(client: Socket): Promise<void> {
    const { token, pairingToken, hostname } = client.handshake.auth as {
      token?: string;
      pairingToken?: string;
      hostname?: string;
    };

    try {
      if (pairingToken) {
        const computer = await this.agents.pair(pairingToken, hostname ?? "unknown");
        client.data.computerId = computer.id;
        client.data.clubId = computer.clubId;
        await client.join(agentRoom(computer.id));
        client.emit("paired", {
          computerId: computer.id,
          computerName: computer.name,
          zoneName: computer.zone.name,
          clubName: computer.club.name,
        });
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
