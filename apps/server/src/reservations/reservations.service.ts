import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PaymentMethod,
  type Reservation,
  ReservationStatus,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  CreateReservationDto,
  UpdateReservationStatusDto,
} from "./reservations.dto.js";

/** Строка брони для списка: с названиями ресурса. */
export interface ReservationRow {
  id: string;
  zoneId: string | null;
  computerId: string | null;
  resource: string;
  guestName: string;
  guestPhone: string | null;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  prepaid: number;
  note: string | null;
}

const ACTIVE: ReservationStatus[] = [
  ReservationStatus.BOOKED,
  ReservationStatus.ARRIVED,
];

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
  ) {}

  async create(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateReservationDto,
  ): Promise<Reservation> {
    await this.access.requireClub(staff, clubId);

    const hasZone = !!dto.zoneId;
    const hasComputer = !!dto.computerId;
    if (hasZone === hasComputer) {
      throw new BadRequestException("Выберите либо зону, либо машину");
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException("Конец брони должен быть позже начала");
    }

    // Карта машин по зонам — чтобы понять, какие машины занимает бронь.
    const computers = await this.prisma.computer.findMany({
      where: { clubId },
      select: { id: true, name: true, zoneId: true },
    });
    const zoneOf = new Map(computers.map((c) => [c.id, c.zoneId]));

    // Проверяем, что бронируемый ресурс существует в этом клубе.
    if (hasComputer && !zoneOf.has(dto.computerId!)) {
      throw new NotFoundException("Машина не найдена");
    }
    if (hasZone && !computers.some((c) => c.zoneId === dto.zoneId)) {
      const zone = await this.prisma.zone.findFirst({
        where: { id: dto.zoneId, clubId },
      });
      if (!zone) throw new NotFoundException("Зона не найдена");
    }

    // Множество машин, которые займёт новая бронь.
    const seats = (
      zoneId: string | null,
      computerId: string | null,
    ): Set<string> => {
      if (computerId) return new Set([computerId]);
      return new Set(
        computers.filter((c) => c.zoneId === zoneId).map((c) => c.id),
      );
    };
    const mine = seats(dto.zoneId ?? null, dto.computerId ?? null);

    // Пересечение по времени И по машинам = конфликт.
    const overlapping = await this.prisma.reservation.findMany({
      where: {
        clubId,
        status: { in: ACTIVE },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { zoneId: true, computerId: true },
    });
    for (const r of overlapping) {
      const theirs = seats(r.zoneId, r.computerId);
      for (const s of mine) {
        if (theirs.has(s)) {
          throw new BadRequestException("На это время ресурс уже забронирован");
        }
      }
    }

    const prepaid = dto.prepaid ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          clubId,
          zoneId: dto.zoneId ?? null,
          computerId: dto.computerId ?? null,
          guestName: dto.guestName.trim(),
          guestPhone: dto.guestPhone?.trim() || null,
          startsAt,
          endsAt,
          prepaid,
          note: dto.note?.trim() || null,
          staffId: staff.id,
        },
      });

      // Предоплата — это деньги в кассу: проводим в открытую смену, чтобы
      // касса сходилась. Применение к будущей сессии — забота кассира.
      const method = this.toMethod(dto.prepaidMethod);
      if (prepaid > 0 && method) {
        const shift = await tx.shift.findFirst({
          where: { clubId, closedAt: null },
          orderBy: { openedAt: "desc" },
        });
        await tx.payment.create({
          data: {
            clubId,
            shiftId: shift?.id ?? null,
            staffId: staff.id,
            amount: prepaid,
            method,
          },
        });
      }

      return reservation;
    });
  }

  async list(
    staff: AuthenticatedStaff,
    clubId: string,
    from: Date,
    to: Date,
  ): Promise<ReservationRow[]> {
    await this.access.requireClub(staff, clubId);
    const rows = await this.prisma.reservation.findMany({
      where: { clubId, startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: "asc" },
      include: {
        zone: { select: { name: true } },
        computer: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      zoneId: r.zoneId,
      computerId: r.computerId,
      resource: r.computer ? `ПК ${r.computer.name}` : (r.zone?.name ?? "—"),
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      prepaid: r.prepaid,
      note: r.note,
    }));
  }

  async setStatus(
    staff: AuthenticatedStaff,
    clubId: string,
    id: string,
    dto: UpdateReservationStatusDto,
  ): Promise<Reservation> {
    await this.access.requireClub(staff, clubId);
    const existing = await this.prisma.reservation.findFirst({
      where: { id, clubId },
    });
    if (!existing) throw new NotFoundException("Бронь не найдена");
    return this.prisma.reservation.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  private toMethod(value?: string): PaymentMethod | null {
    if (value === "CASH") return PaymentMethod.CASH;
    if (value === "CARD") return PaymentMethod.CARD;
    if (value === "ONLINE") return PaymentMethod.ONLINE;
    return null;
  }
}
