import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  ReservationStatus,
  SegmentEndReason,
  SessionStatus,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { SessionsService } from "../sessions/sessions.service.js";

const WARN_MINUTES = 10;

/**
 * Делает бронь «живой»: за 10 минут до начала предупреждает занятый ПК, а в
 * момент брони — по настройке клуба — либо снова предупреждает, либо завершает
 * чужую сессию и блокирует ПК под бронь. Метки warnedAt/enforcedAt не дают
 * слать и выполнять действие повторно.
 */
@Injectable()
export class ReservationsScheduler {
  private readonly log = new Logger(ReservationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
    private readonly sessions: SessionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    const now = new Date();
    try {
      await this.warnUpcoming(now);
      await this.enforceStarted(now);
    } catch (error) {
      this.log.error("Не удалось обработать брони", error as Error);
    }
  }

  /** За 10 минут до начала — предупредить тех, кто ещё сидит на забронированном ПК. */
  private async warnUpcoming(now: Date): Promise<void> {
    const soon = new Date(now.getTime() + WARN_MINUTES * 60_000);
    const upcoming = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.BOOKED,
        warnedAt: null,
        startsAt: { gt: now, lte: soon },
      },
      include: {
        club: { select: { timezone: true } },
        computers: { select: { computerId: true } },
      },
    });
    for (const r of upcoming) {
      const occupied = await this.targetComputers(r);
      const at = this.localTime(r.startsAt, r.club.timezone);
      for (const computerId of occupied) {
        this.bus.emit("pc.message", {
          clubId: r.clubId,
          computerId,
          text: `Этот ПК забронирован на ${at}. Пожалуйста, завершите сессию.`,
        });
      }
      await this.prisma.reservation.update({
        where: { id: r.id },
        data: { warnedAt: now },
      });
    }
  }

  /** Время брони настало: по настройке клуба предупредить или освободить ПК. */
  private async enforceStarted(now: Date): Promise<void> {
    const started = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.BOOKED,
        enforcedAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: {
        club: { select: { timezone: true, reservationAutoLock: true } },
        computers: { select: { computerId: true } },
      },
    });
    for (const r of started) {
      const occupied = await this.targetComputers(r);
      if (r.club.reservationAutoLock) {
        // Завершаем чужие сессии — finish ставит ПК в IDLE и блокирует агента.
        const sessions = await this.prisma.session.findMany({
          where: {
            computerId: { in: occupied },
            status: { in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
            endedAt: null,
          },
          select: { id: true },
        });
        for (const s of sessions) {
          await this.sessions.finish(s.id, SegmentEndReason.STOPPED_BY_STAFF);
        }
      } else {
        for (const computerId of occupied) {
          this.bus.emit("pc.message", {
            clubId: r.clubId,
            computerId,
            text: "Время брони настало — освободите ПК, он забронирован.",
          });
        }
      }
      await this.prisma.reservation.update({
        where: { id: r.id },
        data: { enforcedAt: now },
      });
    }
  }

  /**
   * Какие занятые ПК нужно освободить/предупредить под эту бронь.
   *
   * Конкретные ПК (в т.ч. старая бронь одного ПК) — занятые среди них. Вся зона —
   * все занятые ПК зоны. На количество N — ровно столько занятых ПК зоны,
   * сколько не хватает до N свободных (освобождать больше незачем).
   */
  private async targetComputers(r: {
    clubId: string;
    zoneId: string | null;
    computerId: string | null;
    quantity: number | null;
    computers: { computerId: string }[];
  }): Promise<string[]> {
    const busyIn = async (ids: string[]): Promise<string[]> => {
      if (ids.length === 0) return [];
      const busy = await this.prisma.session.findMany({
        where: {
          computerId: { in: ids },
          status: { in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
          endedAt: null,
        },
        select: { computerId: true },
      });
      return [...new Set(busy.map((s) => s.computerId))];
    };

    // Конкретные ПК.
    const specIds = r.computers.map((x) => x.computerId);
    if (specIds.length > 0) return busyIn(specIds);
    if (r.computerId) return busyIn([r.computerId]);

    // Дальше — на уровне зоны.
    if (!r.zoneId) return [];
    const zonePcs = (
      await this.prisma.computer.findMany({
        where: { clubId: r.clubId, zoneId: r.zoneId },
        select: { id: true },
      })
    ).map((c) => c.id);
    const busy = await busyIn(zonePcs);

    // На количество: освобождаем ровно столько, сколько не хватает до N свободных.
    if (r.quantity && r.quantity > 0) {
      const free = zonePcs.length - busy.length;
      const need = Math.max(0, r.quantity - free);
      return busy.slice(0, need);
    }
    // Вся зона.
    return busy;
  }

  private localTime(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("ru-KZ", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
}
