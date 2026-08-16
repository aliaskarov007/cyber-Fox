import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type Guest,
  type GuestPackage,
  GuestPackageStatus,
  type PaymentMethod,
  TariffKind,
  TransactionType,
} from "@prisma/client";
import bcrypt from "bcryptjs";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { bonusFor } from "../shifts/shift.rules.js";
import type { BuyPackageDto, CreateGuestDto, TopUpDto } from "./guests.dto.js";
import { WalletService } from "./wallet.service.js";

/**
 * Гость в том виде, в каком его отдаёт API.
 *
 * Хеш PIN и счётчик попыток наружу не выходят: PIN — это ключ гостя от игрового
 * ПК, и в ответе кассового экрана ему делать нечего.
 */
export interface PublicGuest {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string;
  bonusPoints: number;
  hasPin: boolean;
  createdAt: Date;
}

export interface GuestWithBalance {
  guest: PublicGuest;
  balance: number;
  walletClubId: string | null;
  packages: GuestPackage[];
}

/** Строка истории счёта: либо одна операция, либо визит целиком. */
export interface HistoryEntry {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  comment: string | null;
  createdAt: Date;
  /** Сколько поминутных списаний схлопнуто в эту строку. */
  minutes: number | null;
}

/**
 * Схлопывает поминутные списания в один визит.
 *
 * Час игры — это шестьдесят одинаковых строк «Игра −5 ₸»: на стойке по такой
 * истории ничего не разобрать. Гостю и администратору нужен визит целиком,
 * а поминутная детализация остаётся в отрезках сессии.
 */
export function groupSessionCharges(
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    comment: string | null;
    createdAt: Date;
    sessionId: string | null;
  }>,
  sessions: Array<{ id: string; computer: { name: string } }>,
): HistoryEntry[] {
  const computerBySession = new Map(sessions.map((s) => [s.id, s.computer.name]));
  const grouped = new Map<string, HistoryEntry>();
  const entries: HistoryEntry[] = [];

  for (const t of transactions) {
    if (t.type !== "SESSION_CHARGE" || !t.sessionId) {
      entries.push({ ...t, minutes: null });
      continue;
    }

    const existing = grouped.get(t.sessionId);
    if (existing) {
      existing.amount += t.amount;
      existing.minutes = (existing.minutes ?? 0) + 1;
      // Список идёт от новых к старым, поэтому баланс визита — самый ранний.
      existing.balanceAfter = t.balanceAfter;
      continue;
    }

    const entry: HistoryEntry = {
      id: `session:${t.sessionId}`,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      comment: computerBySession.get(t.sessionId) ?? null,
      createdAt: t.createdAt,
      minutes: 1,
    };
    grouped.set(t.sessionId, entry);
    entries.push(entry);
  }

  return entries;
}

export function toPublicGuest(guest: Guest): PublicGuest {
  return {
    id: guest.id,
    tenantId: guest.tenantId,
    fullName: guest.fullName,
    phone: guest.phone,
    bonusPoints: guest.bonusPoints,
    hasPin: guest.pinHash !== null,
    createdAt: guest.createdAt,
  };
}

@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
  ) {}

  async search(staff: AuthenticatedStaff, clubId: string, query: string): Promise<PublicGuest[]> {
    await this.access.requireClub(staff, clubId);
    const trimmed = query.trim();

    const guests = await this.prisma.guest.findMany({
      // Аккаунт принадлежит сети, поэтому ищем по всей сети: гость,
      // заведённый в соседнем зале, должен находиться и здесь.
      where: {
        tenantId: staff.tenantId,
        ...(trimmed.length > 0
          ? {
              OR: [
                { phone: { contains: trimmed } },
                { fullName: { contains: trimmed, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { fullName: "asc" },
      take: 25,
    });

    return guests.map(toPublicGuest);
  }

  async create(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateGuestDto,
  ): Promise<PublicGuest> {
    await this.access.requireClub(staff, clubId);
    const phone = dto.phone.trim();

    const existing = await this.prisma.guest.findUnique({
      where: { tenantId_phone: { tenantId: staff.tenantId, phone } },
    });
    if (existing) throw new BadRequestException("Гость с таким телефоном уже есть");

    const guest = await this.prisma.guest.create({
      data: {
        tenantId: staff.tenantId,
        fullName: dto.fullName.trim(),
        phone,
        pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : null,
      },
    });

    return toPublicGuest(guest);
  }

  /** Карточка гостя глазами конкретного клуба: баланс его кошелька и минуты этого зала. */
  async getWithBalance(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
  ): Promise<GuestWithBalance> {
    await this.access.requireClub(staff, clubId);
    const guest = await this.requireGuest(staff.tenantId, guestId);

    const wallet = await this.wallets.resolveWallet(guest.id, clubId);
    const packages = await this.prisma.guestPackage.findMany({
      where: {
        guestId: guest.id,
        clubId,
        status: GuestPackageStatus.ACTIVE,
        minutesRemaining: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: "asc" },
    });

    return {
      guest: toPublicGuest(guest),
      balance: wallet.balance,
      walletClubId: wallet.clubId,
      packages,
    };
  }

  /**
   * История гостя: визиты, движения по кошельку и купленные пакеты.
   * Первое, что спрашивают на стойке при разборе спорной суммы.
   */
  async history(staff: AuthenticatedStaff, clubId: string, guestId: string) {
    await this.access.requireClub(staff, clubId);
    const guest = await this.requireGuest(staff.tenantId, guestId);
    const wallet = await this.wallets.resolveWallet(guest.id, clubId);

    const [sessions, transactions, packages] = await Promise.all([
      this.prisma.session.findMany({
        where: { guestId: guest.id },
        orderBy: { startedAt: "desc" },
        take: 20,
        include: {
          computer: { select: { name: true } },
          zone: { select: { name: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        // Берём с запасом: поминутные списания схлопываются в один визит,
        // поэтому строк на выходе будет заметно меньше.
        take: 400,
      }),
      this.prisma.guestPackage.findMany({
        where: { guestId: guest.id },
        orderBy: { purchasedAt: "desc" },
        take: 20,
        include: { zone: { select: { name: true } } },
      }),
    ]);

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        computerName: s.computer.name,
        zoneName: s.zone.name,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        totalCharged: s.totalCharged,
        startedBy: s.startedBy,
      })),
      transactions: groupSessionCharges(transactions, sessions),
      packages: packages.map((p) => ({
        id: p.id,
        zoneName: p.zone.name,
        minutesTotal: p.minutesTotal,
        minutesRemaining: p.minutesRemaining,
        pricePaid: p.pricePaid,
        purchasedAt: p.purchasedAt,
        expiresAt: p.expiresAt,
        status: p.status,
      })),
    };
  }

  async topUp(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
    dto: TopUpDto,
  ): Promise<{ balance: number }> {
    await this.access.requireClub(staff, clubId);
    const guest = await this.requireGuest(staff.tenantId, guestId);

    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.wallets.resolveWallet(guest.id, clubId, tx);

      // Пополнение записывается в клуб, где физически принят платёж: это его касса
      // и его сверка смены, даже если кошелёк общий на сеть.
      const updated = await this.wallets.record(tx, {
        walletId: wallet.id,
        clubId,
        amount: dto.amount,
        type: TransactionType.TOPUP,
      });

      await tx.payment.create({
        data: {
          clubId,
          guestId: guest.id,
          staffId: staff.id,
          amount: dto.amount,
          method: dto.method,
          shiftId: await this.currentShiftId(tx, clubId),
        },
      });

      return { balance: updated.balance };
    });
  }

  /**
   * Продажа пакета: минуты ложатся на аккаунт гостя и живут там до исчерпания
   * или истечения срока. В долг пакет не продаётся — долг существует, чтобы дать
   * доиграть начатое, а не чтобы кредитовать покупки.
   */
  async buyPackage(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
    dto: BuyPackageDto,
  ): Promise<GuestPackage> {
    const club = await this.access.requireClub(staff, clubId);
    const guest = await this.requireGuest(staff.tenantId, guestId);

    const tariff = await this.prisma.tariff.findUnique({ where: { id: dto.tariffId } });
    if (!tariff || tariff.clubId !== clubId) throw new NotFoundException("Тариф не найден");
    if (tariff.kind !== TariffKind.PACKAGE) throw new BadRequestException("Это не пакетный тариф");
    if (!tariff.packageMinutes || tariff.packagePrice === null) {
      throw new BadRequestException("У тарифа не заданы минуты или цена");
    }

    const price = tariff.packagePrice;
    const validityDays = tariff.validityDays ?? club.packageValidityDays;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.wallets.resolveWallet(guest.id, clubId, tx);

      if (dto.method === "BALANCE") {
        if (wallet.balance < price) {
          throw new BadRequestException(
            "Недостаточно средств: пакет в долг не продаётся. Пополните счёт.",
          );
        }
        await this.wallets.record(tx, {
          walletId: wallet.id,
          clubId,
          amount: -price,
          type: TransactionType.PACKAGE_PURCHASE,
          comment: tariff.name,
        });
      } else {
        // Наличные и карта принимаются на стойке: деньги не проходят через кошелёк,
        // но платёж попадает в кассу смены.
        await tx.payment.create({
          data: {
            clubId,
            guestId: guest.id,
            staffId: staff.id,
            amount: price,
            method: dto.method as PaymentMethod,
            shiftId: await this.currentShiftId(tx, clubId),
          },
        });
      }

      // Бонусы за покупку пакета — то же правило, что и для поминутной игры:
      // процент от реально потраченного.
      const bonus = bonusFor(price, club.bonusPercent);
      if (bonus > 0) {
        await tx.guest.update({
          where: { id: guest.id },
          data: { bonusPoints: { increment: bonus } },
        });
      }

      return tx.guestPackage.create({
        data: {
          clubId,
          guestId: guest.id,
          zoneId: tariff.zoneId,
          sourceTariffId: tariff.id,
          minutesTotal: tariff.packageMinutes!,
          minutesRemaining: tariff.packageMinutes!,
          pricePaid: price,
          expiresAt,
        },
      });
    });
  }

  async setPin(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
    pin: string,
  ): Promise<void> {
    await this.access.requireClub(staff, clubId);
    const guest = await this.requireGuest(staff.tenantId, guestId);

    await this.prisma.guest.update({
      where: { id: guest.id },
      data: {
        pinHash: await bcrypt.hash(pin, 10),
        // Сотрудник, меняющий PIN, заодно снимает блокировку после перебора.
        failedPinAttempts: 0,
        pinLockedUntil: null,
      },
    });
  }

  private async requireGuest(tenantId: string, guestId: string): Promise<Guest> {
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.tenantId !== tenantId) throw new NotFoundException("Гость не найден");
    return guest;
  }

  private async currentShiftId(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    clubId: string,
  ): Promise<string | null> {
    const shift = await tx.shift.findFirst({
      where: { clubId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
    return shift?.id ?? null;
  }
}
