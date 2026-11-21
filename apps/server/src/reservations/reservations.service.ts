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
  zoneName: string | null;
  computerId: string | null;
  /** Имена конкретных ПК брони (режим «выбрать ПК»). */
  computerNames: string[];
  /** Количество ПК для брони «на количество». null — не этот режим. */
  quantity: number | null;
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

/** Что бронь занимает в своей зоне. */
interface Demand {
  zoneId: string | null;
  /** Конкретные ПК (режимы «выбрать ПК» и старая бронь одного ПК). */
  named: Set<string>;
  /** Количество «плавающих» ПК (режим «на количество»). */
  count: number;
  /** Вся зона целиком. */
  wholeZone: boolean;
}

/** Собрать читаемый список номеров ПК в диапазоны: «20–23, 25». */
function rangeText(names: string[]): string {
  const nums = names
    .map((n) => ({ n, v: Number(n) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => a.v - b.v);
  // Среди имён есть нечисловые — проще перечислить через запятую.
  if (nums.length !== names.length) {
    return [...names]
      .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
      .join(", ");
  }
  const parts: string[] = [];
  let start = nums[0].v;
  let prev = nums[0].v;
  for (let i = 1; i <= nums.length; i++) {
    const cur = nums[i]?.v;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    if (cur !== undefined) {
      start = cur;
      prev = cur;
    }
  }
  return parts.join(", ");
}

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
    const byId = new Map(computers.map((c) => [c.id, c]));

    // Конкретные ПК: новый клиент шлёт computerIds, старый — один computerId.
    const specificIds = [
      ...new Set(
        dto.computerIds && dto.computerIds.length > 0
          ? dto.computerIds
          : dto.computerId
            ? [dto.computerId]
            : [],
      ),
    ];

    // Определяем зону брони и проверяем, что ПК из неё и существуют.
    let zoneId = dto.zoneId ?? null;
    if (specificIds.length > 0) {
      for (const id of specificIds) {
        if (!byId.has(id)) throw new NotFoundException("Машина не найдена");
      }
      const zonesOfPcs = new Set(specificIds.map((id) => byId.get(id)!.zoneId));
      if (zonesOfPcs.size > 1) {
        throw new BadRequestException("Выбранные ПК должны быть из одной зоны");
      }
      const pcZone = [...zonesOfPcs][0];
      if (zoneId && zoneId !== pcZone) {
        throw new BadRequestException("Выбранные ПК не из указанной зоны");
      }
      zoneId = pcZone;
    }
    if (!zoneId) {
      throw new BadRequestException("Выберите зону");
    }
    const zonePcs = computers.filter((c) => c.zoneId === zoneId);
    if (zonePcs.length === 0) {
      const zone = await this.prisma.zone.findFirst({
        where: { id: zoneId, clubId },
      });
      if (!zone) throw new NotFoundException("Зона не найдена");
    }
    const capacity = zonePcs.length;

    // Режим новой брони: конкретные ПК / количество / вся зона.
    const named = new Set(specificIds);
    let count = 0;
    let wholeZone = false;
    if (specificIds.length > 0) {
      // Конкретные ПК.
    } else if (dto.quantity && dto.quantity > 0) {
      count = dto.quantity;
      if (count > capacity) {
        throw new BadRequestException(`В зоне всего ${capacity} ПК`);
      }
    } else {
      wholeZone = true;
    }

    // Пересекающиеся по времени активные брони — считаем занятость зоны.
    const overlapping = await this.prisma.reservation.findMany({
      where: {
        clubId,
        status: { in: ACTIVE },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: {
        zoneId: true,
        computerId: true,
        quantity: true,
        computers: { select: { computerId: true } },
      },
    });

    const takenNamed = new Set<string>();
    let floatingExisting = 0;
    let wholeZoneTaken = false;
    for (const r of overlapping) {
      const d = this.demandOf(r, byId);
      if (d.zoneId !== zoneId) continue; // другая зона — не конфликтует
      if (d.wholeZone) {
        wholeZoneTaken = true;
        continue;
      }
      for (const id of d.named) takenNamed.add(id);
      floatingExisting += d.count;
    }

    // Проверка вместимости зоны на это время.
    if (wholeZoneTaken) {
      throw new BadRequestException("На это время вся зона уже забронирована");
    }
    if (wholeZone) {
      if (takenNamed.size > 0 || floatingExisting > 0) {
        throw new BadRequestException(
          "Нельзя забронировать всю зону — на это время в ней уже есть брони",
        );
      }
    } else {
      for (const id of named) {
        if (takenNamed.has(id)) {
          throw new BadRequestException(
            `ПК ${byId.get(id)?.name ?? ""} уже забронирован на это время`.trim(),
          );
        }
      }
      const usedNamed = new Set([...takenNamed, ...named]).size;
      if (usedNamed + floatingExisting + count > capacity) {
        const free = Math.max(0, capacity - usedNamed - floatingExisting);
        throw new BadRequestException(
          `В зоне на это время свободно ${free} ПК`,
        );
      }
    }

    const prepaid = dto.prepaid ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          clubId,
          zoneId,
          computerId: null,
          quantity: count > 0 ? count : null,
          computers:
            named.size > 0
              ? { create: [...named].map((id) => ({ computerId: id })) }
              : undefined,
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
        computers: { include: { computer: { select: { name: true } } } },
      },
    });
    return rows.map((r) => {
      const zoneName = r.zone?.name ?? null;
      const names = r.computers.map((x) => x.computer.name);
      let resource: string;
      if (names.length > 0) {
        // Конкретные ПК: «VIP · ПК 20–23».
        resource = `${zoneName ? `${zoneName} · ` : ""}ПК ${rangeText(names)}`;
      } else if (r.computer) {
        // Старая бронь одного ПК.
        resource = `ПК ${r.computer.name}`;
      } else if (r.quantity && r.quantity > 0) {
        // На количество: «Буткемп 2 · 3 ПК (любые)».
        resource = `${zoneName ? `${zoneName} · ` : ""}${r.quantity} ПК (любые)`;
      } else {
        // Вся зона.
        resource = zoneName ?? "—";
      }
      return {
        id: r.id,
        zoneId: r.zoneId,
        zoneName,
        computerId: r.computerId,
        computerNames: names,
        quantity: r.quantity,
        resource,
        guestName: r.guestName,
        guestPhone: r.guestPhone,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status,
        prepaid: r.prepaid,
        note: r.note,
      };
    });
  }

  /** Что бронь занимает в зоне: конкретные ПК, количество или вся зона. */
  private demandOf(
    r: {
      zoneId: string | null;
      computerId: string | null;
      quantity: number | null;
      computers: { computerId: string }[];
    },
    byId: ReadonlyMap<string, { zoneId: string }>,
  ): Demand {
    const specIds = r.computers
      .map((x) => x.computerId)
      .filter((id) => byId.has(id));
    if (specIds.length > 0) {
      return {
        zoneId: byId.get(specIds[0])!.zoneId,
        named: new Set(specIds),
        count: 0,
        wholeZone: false,
      };
    }
    if (r.computerId && byId.has(r.computerId)) {
      return {
        zoneId: byId.get(r.computerId)!.zoneId,
        named: new Set([r.computerId]),
        count: 0,
        wholeZone: false,
      };
    }
    if (r.quantity && r.quantity > 0) {
      return { zoneId: r.zoneId, named: new Set(), count: r.quantity, wholeZone: false };
    }
    return { zoneId: r.zoneId, named: new Set(), count: 0, wholeZone: true };
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
