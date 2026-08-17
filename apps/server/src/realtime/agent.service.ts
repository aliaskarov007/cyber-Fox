import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ComputerStatus,
  GuestPackageStatus,
  SessionStartedBy,
  SessionStatus,
  SegmentEndReason,
} from "@prisma/client";
import bcrypt from "bcryptjs";

import { minutesAffordable, pickPerMinuteTariff } from "../billing/billing.rules.js";
import { SubscriptionService } from "../billing-platform/subscription.service.js";
import { toLocalMoment } from "../common/local-time.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { normalizeMac } from "./agent.rules.js";

/** Сколько неверных попыток PIN подряд до блокировки ввода. */
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

export interface GuestLoginResult {
  ok: boolean;
  reason: string | null;
  guest: { id: string; fullName: string; balance: number } | null;
  /** Минуты гостя в зоне этого ПК — ими можно играть прямо сейчас. */
  packagesInZone: Array<{ id: string; minutesRemaining: number; expiresAt: Date }>;
  /** Минуты в других зонах — показываем с пометкой, что здесь не действуют. */
  packagesElsewhere: Array<{ id: string; zoneName: string; minutesRemaining: number }>;
  perMinutePrice: number | null;
  minutesAffordable: number | null;
}

/**
 * Обслуживание агента на игровом ПК: привязка машины и самостоятельный вход гостя.
 * Сервер здесь — единственный арбитр: агент только показывает экран и передаёт запрос.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly wallets: WalletService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Первое подключение агента: машина узнаётся по коду привязки. */
  async pair(pairingToken: string, hostname: string) {
    const computer = await this.prisma.computer.findUnique({
      where: { pairingToken },
      include: { club: true, zone: true },
    });
    if (!computer) throw new NotFoundException("Неизвестный код привязки");

    await this.prisma.computer.update({
      where: { id: computer.id },
      data: {
        hostname,
        lastSeenAt: new Date(),
        // Статус ставим по факту: занятая машина не должна «освободиться»
        // просто оттого, что агент переподключился.
        status:
          computer.status === ComputerStatus.IN_USE
            ? ComputerStatus.IN_USE
            : ComputerStatus.IDLE,
      },
    });

    return computer;
  }

  /**
   * Подключение машины бездискового зала.
   *
   * Там все ПК грузятся с одного образа, и код привязки в него не положишь: он
   * у каждой машины свой, а настройки в профиле стираются при перезагрузке.
   * Поэтому в образ кладётся один ключ на клуб, а различает машины MAC — без
   * уникального MAC сама загрузка по сети невозможна, так что признак надёжный.
   *
   * Незнакомая машина заводится сама: сорок ПК иначе пришлось бы вносить
   * руками, сверяя MAC-адреса с наклейками на корпусах.
   */
  async enroll(enrollmentKey: string, macAddress: string, hostname: string) {
    const mac = normalizeMac(macAddress);
    if (!mac) throw new BadRequestException("Агент не сообщил MAC-адрес");

    const club = await this.prisma.club.findUnique({
      where: { enrollmentKey },
      include: { zones: { orderBy: { sortOrder: "asc" }, take: 1 } },
    });
    if (!club) throw new NotFoundException("Неизвестный ключ клуба");

    const known = await this.prisma.computer.findUnique({
      where: { clubId_macAddress: { clubId: club.id, macAddress: mac } },
      include: { club: true, zone: true },
    });
    if (known) {
      await this.prisma.computer.update({
        where: { id: known.id },
        data: {
          hostname,
          lastSeenAt: new Date(),
          status:
            known.status === ComputerStatus.IN_USE
              ? ComputerStatus.IN_USE
              : ComputerStatus.IDLE,
        },
      });
      return known;
    }

    const zone = club.zones[0];
    if (!zone) {
      throw new BadRequestException("В клубе нет ни одной зоны — заведите её перед подключением");
    }

    // Лимит подписки проверяем и здесь: иначе бездисковый зал молча заводил бы
    // машины сверх оплаченных, просто загрузившись.
    await this.subscriptions.assertCanAddComputer(club.tenantId);

    const created = await this.prisma.computer.create({
      data: {
        clubId: club.id,
        zoneId: zone.id,
        name: await this.freeName(club.id, hostname),
        macAddress: mac,
        hostname,
        status: ComputerStatus.IDLE,
        lastSeenAt: new Date(),
      },
      include: { club: true, zone: true },
    });

    this.logger.log(
      `Бездисковый зал: подключилась новая машина ${created.name} (${mac}) в «${club.name}»`,
    );
    return created;
  }

  /**
   * Имя для новой машины.
   *
   * Берём имя из Windows — в бездисковом зале оно у каждой машины своё и обычно
   * совпадает с наклейкой на корпусе. Занятое имя дополняем MAC-хвостом, чтобы
   * подключение не падало из-за совпадения.
   */
  private async freeName(clubId: string, hostname: string): Promise<string> {
    const wanted = hostname.trim() || "Новая машина";
    const taken = await this.prisma.computer.findUnique({
      where: { clubId_name: { clubId, name: wanted } },
    });
    if (!taken) return wanted;

    const suffix = Math.random().toString(16).slice(2, 6);
    return `${wanted}-${suffix}`;
  }

  async heartbeat(computerId: string): Promise<void> {
    await this.prisma.computer.update({
      where: { id: computerId },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Самостоятельный вход гостя по телефону и PIN.
   *
   * Отказ объясняется причиной: гость должен понимать, идти ли ему к стойке.
   * Счётчик попыток ведётся по аккаунту, а не по машине — перебор с соседнего
   * ПК не обходит блокировку (docs/guest-access.md, раздел 2).
   */
  async guestLogin(computerId: string, phone: string, pin: string): Promise<GuestLoginResult> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true, zone: true },
    });
    if (!computer) throw new NotFoundException("ПК не найден");

    const empty: GuestLoginResult = {
      ok: false,
      reason: null,
      guest: null,
      packagesInZone: [],
      packagesElsewhere: [],
      perMinutePrice: null,
      minutesAffordable: null,
    };

    const guest = await this.prisma.guest.findUnique({
      where: {
        tenantId_phone: { tenantId: computer.club.tenantId, phone: phone.trim() },
      },
    });

    if (!guest?.pinHash) {
      return { ...empty, reason: "Неверный номер или PIN" };
    }

    if (guest.pinLockedUntil && guest.pinLockedUntil > new Date()) {
      return {
        ...empty,
        reason: "Вход заблокирован после нескольких неверных попыток. Подойдите к администратору.",
      };
    }

    if (!(await bcrypt.compare(pin, guest.pinHash))) {
      const attempts = guest.failedPinAttempts + 1;
      await this.prisma.guest.update({
        where: { id: guest.id },
        data: {
          failedPinAttempts: attempts,
          pinLockedUntil:
            attempts >= MAX_PIN_ATTEMPTS
              ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000)
              : null,
        },
      });
      return { ...empty, reason: "Неверный номер или PIN" };
    }

    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { failedPinAttempts: 0, pinLockedUntil: null },
    });

    if (computer.status === ComputerStatus.RESERVED) {
      return { ...empty, reason: "Место забронировано. Подойдите к администратору." };
    }
    if (computer.status === ComputerStatus.MAINTENANCE) {
      return { ...empty, reason: "ПК на обслуживании." };
    }

    const openSession = await this.prisma.session.findFirst({
      where: {
        clubId: computer.clubId,
        guestId: guest.id,
        status: { in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
      },
      include: { computer: { select: { name: true } } },
    });
    if (openSession) {
      return { ...empty, reason: `У вас уже открыта сессия на ${openSession.computer.name}` };
    }

    const wallet = await this.wallets.resolveWallet(guest.id, computer.clubId);
    if (wallet.balance < 0) {
      return {
        ...empty,
        reason: "На счету долг. Подойдите к администратору, чтобы его погасить.",
      };
    }

    const now = new Date();
    const moment = toLocalMoment(now, computer.club.timezone);

    const packages = await this.prisma.guestPackage.findMany({
      where: {
        guestId: guest.id,
        clubId: computer.clubId,
        status: GuestPackageStatus.ACTIVE,
        minutesRemaining: { gt: 0 },
        expiresAt: { gt: now },
      },
      include: { zone: { select: { name: true } } },
      orderBy: { expiresAt: "asc" },
    });

    const tariffs = await this.prisma.tariff.findMany({
      where: { zoneId: computer.zoneId, kind: "PER_MINUTE", isActive: true },
    });
    const perMinute = pickPerMinuteTariff(
      tariffs.map((t) => ({
        id: t.id,
        pricePerMinute: t.pricePerMinute ?? 0,
        activeFromMinute: t.activeFromMinute,
        activeToMinute: t.activeToMinute,
        daysOfWeek: t.daysOfWeek,
      })),
      moment,
    );

    const inZone = packages.filter((p) => p.zoneId === computer.zoneId);
    const price = perMinute?.pricePerMinute ?? 0;
    const affordable = price > 0
      ? minutesAffordable({ balance: wallet.balance, creditLimit: computer.club.creditLimit }, price)
      : 0;

    // Долг даётся, чтобы доиграть начатое, а не чтобы начать: если минут нет и
    // баланса не хватает даже на минуту, вход отклоняется.
    if (inZone.length === 0 && (price === 0 || wallet.balance < price)) {
      return {
        ...empty,
        guest: { id: guest.id, fullName: guest.fullName, balance: wallet.balance },
        reason: "Недостаточно средств. Подойдите к администратору, чтобы пополнить счёт.",
      };
    }

    return {
      ok: true,
      reason: null,
      guest: { id: guest.id, fullName: guest.fullName, balance: wallet.balance },
      packagesInZone: inZone.map((p) => ({
        id: p.id,
        minutesRemaining: p.minutesRemaining,
        expiresAt: p.expiresAt,
      })),
      packagesElsewhere: packages
        .filter((p) => p.zoneId !== computer.zoneId)
        .map((p) => ({ id: p.id, zoneName: p.zone.name, minutesRemaining: p.minutesRemaining })),
      perMinutePrice: perMinute?.pricePerMinute ?? null,
      minutesAffordable: affordable,
    };
  }

  /** Гость подтвердил старт на экране блокировки. */
  async startByGuest(computerId: string, guestId: string, tariffId: string | null) {
    const computer = await this.prisma.computer.findUnique({ where: { id: computerId } });
    if (!computer) throw new NotFoundException("ПК не найден");

    return this.sessions.start({
      clubId: computer.clubId,
      computerId,
      guestId,
      tariffId,
      startedBy: SessionStartedBy.GUEST,
    });
  }

  /** Гость закрыл сессию сам — списание останавливается сразу. */
  async stopByGuest(computerId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.computerId !== computerId) {
      throw new BadRequestException("Сессия не относится к этому ПК");
    }
    return this.sessions.finish(sessionId, SegmentEndReason.STOPPED_BY_GUEST);
  }
}
