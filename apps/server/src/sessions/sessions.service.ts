import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ComputerStatus,
  PaymentMethod,
  type Prisma,
  type Session,
  SegmentEndReason,
  SessionStartedBy,
  SessionStatus,
  GuestPackageStatus,
  TariffKind,
  TransactionType,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import {
  type PackageState,
  type PerMinuteTariffState,
  type SessionBillingState,
  type WalletState,
  creditLeft,
  decideNextMinute,
  minutesAffordable,
  pickNextPackage,
  pickPerMinuteTariff,
} from "../billing/billing.rules.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { toLocalMoment } from "../common/local-time.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { SubscriptionService } from "../billing-platform/subscription.service.js";
import { bonusFor } from "../shifts/shift.rules.js";
import type { MoveSessionDto, StartSessionDto } from "./sessions.dto.js";

const MINUTE_MS = 60_000;

/**
 * Предохранитель на догон после долгого простоя: больше суток минут за один
 * проход не досчитываем, даже если денег хватает. Такой разрыв означает аварию,
 * которую надо разобрать руками, а не молча списать с гостя.
 */
const MAX_CATCH_UP_MINUTES = 24 * 60;

/**
 * Сколько ждать сердцебиение агента, прежде чем считать машину замолчавшей.
 * Агент шлёт его раз в 30 секунд, так что три пропуска — уже не случайность.
 */
const AGENT_GRACE_MS = 95_000;

/**
 * Через сколько молчания сессия закрывается сама. Машину выключили или
 * унесли — держать место занятым в карте зала нельзя.
 */
const AGENT_LOST_MS = 30 * 60_000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
    private readonly bus: RealtimeBus,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // --- Старт ---

  async startByStaff(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: StartSessionDto,
  ): Promise<Session> {
    await this.access.requireClub(staff, clubId);
    return this.start({
      clubId,
      computerId: dto.computerId,
      guestId: dto.guestId ?? null,
      tariffId: dto.tariffId ?? null,
      startedBy: SessionStartedBy.STAFF,
      prepaidAmount: dto.prepaidAmount ?? null,
    });
  }

  /**
   * Общая точка старта для обоих путей входа: гость за ПК и сотрудник со стойки
   * приходят сюда же. Проверки состояния ПК живут здесь, потому что сервер —
   * единственный арбитр (docs/guest-access.md, раздел 4).
   */
  async start(params: {
    clubId: string;
    computerId: string;
    guestId: string | null;
    tariffId: string | null;
    startedBy: SessionStartedBy;
    /** Предоплата для анонимной посадки, в тиын. */
    prepaidAmount?: number | null;
  }): Promise<Session> {
    const club = await this.prisma.club.findUniqueOrThrow({ where: { id: params.clubId } });
    // Подписка проверяется только при старте: уже идущие сессии доигрывают
    // при любом её состоянии — гость заплатил клубу, а не нам.
    await this.subscriptions.assertCanStartSession(club.tenantId);

    const computer = await this.prisma.computer.findUnique({
      where: { id: params.computerId },
    });
    if (!computer || computer.clubId !== params.clubId) {
      throw new NotFoundException("ПК не найден");
    }
    if (computer.status === ComputerStatus.MAINTENANCE) {
      throw new BadRequestException("ПК на обслуживании");
    }
    if (computer.status === ComputerStatus.RESERVED) {
      throw new BadRequestException("Место забронировано");
    }

    const active = await this.prisma.session.findFirst({
      where: { computerId: computer.id, status: { in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] } },
    });
    if (active) throw new BadRequestException("За этим ПК уже идёт сессия");

    if (params.guestId) {
      // Одна активная сессия на гостя в клубе: иначе гость открывает вторую
      // машину с того же кошелька (docs/guest-access.md, раздел 4).
      const guestActive = await this.prisma.session.findFirst({
        where: {
          clubId: params.clubId,
          guestId: params.guestId,
          status: { in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] },
        },
        include: { computer: { select: { name: true } } },
      });
      if (guestActive) {
        throw new BadRequestException(`У гостя открыта сессия на ${guestActive.computer.name}`);
      }
    }

    const moment = toLocalMoment(new Date(), club.timezone);

    // Чем играем: явно выбранным тарифом, минутами пакета этой зоны либо
    // поминутным тарифом зоны — именно в таком порядке.
    const packages = params.guestId
      ? await this.loadPackages(params.guestId, params.clubId, computer.zoneId)
      : [];
    const perMinuteTariffs = await this.loadPerMinuteTariffs(computer.zoneId);

    let segmentKind: TariffKind;
    let segmentTariffId: string;
    let guestPackageId: string | null = null;

    const explicit = params.tariffId
      ? await this.prisma.tariff.findUnique({ where: { id: params.tariffId } })
      : null;
    if (params.tariffId && (!explicit || explicit.clubId !== params.clubId)) {
      throw new NotFoundException("Тариф не найден");
    }
    if (explicit && explicit.zoneId !== computer.zoneId) {
      throw new BadRequestException("Тариф принадлежит другой зоне");
    }

    if (explicit?.kind === TariffKind.PACKAGE) {
      throw new BadRequestException(
        "Пакет сначала покупается на аккаунт гостя, затем сессия стартует на его минутах",
      );
    }

    const usablePackage = pickNextPackage(packages, computer.zoneId, moment);
    if (explicit) {
      segmentKind = TariffKind.PER_MINUTE;
      segmentTariffId = explicit.id;
    } else if (usablePackage) {
      const pkg = await this.prisma.guestPackage.findUniqueOrThrow({
        where: { id: usablePackage.id },
      });
      segmentKind = TariffKind.PACKAGE;
      segmentTariffId = pkg.sourceTariffId;
      guestPackageId = pkg.id;
    } else {
      const fallback = pickPerMinuteTariff(perMinuteTariffs, moment);
      if (!fallback) {
        throw new BadRequestException("В зоне нет действующего поминутного тарифа");
      }
      segmentKind = TariffKind.PER_MINUTE;
      segmentTariffId = fallback.id;
    }

    // Анонимная посадка идёт строго по предоплате: кошелька, с которого списывать
    // поминутно, у гостя без аккаунта нет, поэтому деньги берутся вперёд на стойке.
    if (!params.guestId && segmentKind === TariffKind.PER_MINUTE && !params.prepaidAmount) {
      throw new BadRequestException(
        "Анонимная посадка возможна только по предоплате: укажите принятую сумму",
      );
    }

    // Первая минута оплачивается авансом, как и все последующие: гость не
    // доигрывает неоплаченную минуту (docs/billing.md, раздел 5.4).
    if (segmentKind === TariffKind.PER_MINUTE) {
      const tariff = perMinuteTariffs.find((t) => t.id === segmentTariffId);
      const price = tariff?.pricePerMinute ?? 0;
      const wallet = params.guestId
        ? await this.walletState(params.guestId, params.clubId, club.creditLimit)
        : { balance: params.prepaidAmount ?? 0, creditLimit: 0 };

      if (wallet.balance - price < -wallet.creditLimit) {
        throw new BadRequestException(
          params.guestId
            ? "Недостаточно средств для начала сессии"
            : `Предоплаты не хватает даже на минуту: минута стоит ${price / 100} ₸`,
        );
      }
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          clubId: params.clubId,
          computerId: computer.id,
          zoneId: computer.zoneId,
          guestId: params.guestId,
          startedBy: params.startedBy,
          status: SessionStatus.ACTIVE,
          prepaidRemaining: params.guestId ? null : (params.prepaidAmount ?? null),
          // Срок первой минуты — сам момент старта: она оплачивается авансом,
          // как и все последующие (docs/billing.md, раздел 5.4).
          nextChargeAt: new Date(),
        },
      });

      // Принятые вперёд наличные попадают в кассу смены — иначе сверка не сойдётся.
      if (!params.guestId && params.prepaidAmount) {
        const shift = await tx.shift.findFirst({
          where: { clubId: params.clubId, closedAt: null },
          orderBy: { openedAt: "desc" },
        });
        await tx.payment.create({
          data: {
            clubId: params.clubId,
            sessionId: created.id,
            shiftId: shift?.id ?? null,
            amount: params.prepaidAmount,
            method: PaymentMethod.CASH,
          },
        });
      }

      await tx.sessionSegment.create({
        data: {
          sessionId: created.id,
          tariffId: segmentTariffId,
          kind: segmentKind,
          guestPackageId,
        },
      });

      await tx.computer.update({
        where: { id: computer.id },
        data: { status: ComputerStatus.IN_USE },
      });

      return created;
    });

    // Первая минута списывается сразу после создания сессии.
    await this.chargeOneMinute(session.id);

    this.bus.emit("session.started", {
      clubId: params.clubId,
      computerId: computer.id,
      sessionId: session.id,
    });
    this.bus.emit("computer.status", {
      clubId: params.clubId,
      computerId: computer.id,
      status: ComputerStatus.IN_USE,
    });

    return this.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
  }

  // --- Движок списания ---

  /**
   * Рабочий списания: выбирает сессии, у которых подошёл срок, пачкой.
   *
   * Таймера на сессию нет специально — сто машин в зале означали бы сотни живых
   * таймеров, исчезающих при перезапуске. Состояние живёт в базе
   * (docs/billing.md, раздел 8).
   */
  async chargeDueSessions(now = new Date()): Promise<number> {
    const due = await this.prisma.session.findMany({
      where: { status: SessionStatus.ACTIVE, nextChargeAt: { lte: now } },
      select: { id: true, computer: { select: { id: true, name: true, lastSeenAt: true } } },
      take: 500,
    });

    let processed = 0;
    for (const session of due) {
      const silentFor = session.computer.lastSeenAt
        ? now.getTime() - session.computer.lastSeenAt.getTime()
        : Number.POSITIVE_INFINITY;

      /*
       * Деньги списываются только за время, подтверждённое агентом.
       *
       * Пока машина молчит, сервер не знает, играет ли на ней кто-нибудь: она
       * может быть выключена, а связь — оборвана. Начислять вслепую значит
       * брать с гостя за время, которого не было, поэтому срок списания просто
       * ждёт, и минуты за молчание не набегают.
       */
      if (silentFor > AGENT_GRACE_MS) {
        if (silentFor > AGENT_LOST_MS) {
          this.logger.warn(
            `${session.computer.name}: агент молчит дольше получаса, закрываем сессию`,
          );
          await this.finish(session.id, SegmentEndReason.AGENT_LOST);
        }
        continue;
      }

      try {
        await this.chargeOneMinute(session.id, now);
        processed += 1;
      } catch (error) {
        this.logger.error(`Не удалось списать минуту сессии ${session.id}`, error as Error);
      }
    }
    return processed;
  }

  /**
   * Обрабатывает сессию до тех пор, пока её срок списания не уйдёт в будущее.
   * Обычно это ровно одна минута; несколько — только при догоне после простоя.
   */
  async chargeOneMinute(sessionId: string, now = new Date()): Promise<void> {
    for (let guard = 0; guard < MAX_CATCH_UP_MINUTES; guard++) {
      const done = await this.applyOneMinute(sessionId, now);
      if (done) return;
    }
    this.logger.warn(`Сессия ${sessionId}: догон прерван предохранителем`);
  }

  /** @returns true — сессии больше нечего досчитывать прямо сейчас. */
  private async applyOneMinute(sessionId: string, now: Date): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        club: true,
        segments: { orderBy: { startedAt: "desc" }, take: 1 },
      },
    });
    if (!session || session.status !== SessionStatus.ACTIVE) return true;
    if (session.nextChargeAt && session.nextChargeAt > now) return true;

    const segment = session.segments[0];
    if (!segment) return true;

    const moment = toLocalMoment(session.nextChargeAt ?? now, session.club.timezone);
    const packages = session.guestId
      ? await this.loadPackages(session.guestId, session.clubId, session.zoneId)
      : [];
    // Для расчёта анонимная посадка — тот же кошелёк, только с предоплаченной
    // суммой и без права уйти в минус. Правила остаются одни на оба случая.
    const wallet = session.guestId
      ? await this.walletState(session.guestId, session.clubId, session.club.creditLimit)
      : session.prepaidRemaining !== null
        ? { balance: session.prepaidRemaining, creditLimit: 0 }
        : null;

    const state: SessionBillingState = {
      zoneId: session.zoneId,
      currentSegment: {
        kind: segment.kind === TariffKind.PACKAGE ? "PACKAGE" : "PER_MINUTE",
        tariffId: segment.tariffId,
        guestPackageId: segment.guestPackageId,
      },
      packages,
      wallet,
      perMinuteTariffs: await this.loadPerMinuteTariffs(session.zoneId),
    };

    const decision = decideNextMinute(state, moment);
    const chargeAt = session.nextChargeAt ?? now;

    switch (decision.kind) {
      case "PACKAGE_MINUTE": {
        await this.prisma.$transaction(async (tx) => {
          await tx.guestPackage.update({
            where: { id: decision.packageId },
            data: { minutesRemaining: { decrement: 1 } },
          });
          await tx.sessionSegment.update({
            where: { id: segment.id },
            data: {
              minutesUsed: { increment: 1 },
              chargedThroughMinute: { increment: 1 },
            },
          });
          await tx.session.update({
            where: { id: session.id },
            data: { nextChargeAt: new Date(chargeAt.getTime() + MINUTE_MS) },
          });
          // Пакет, ушедший в ноль, закрывается сразу: следующий тик увидит,
          // что минут нет, и переключит сессию.
          await tx.guestPackage.updateMany({
            where: { id: decision.packageId, minutesRemaining: { lte: 0 } },
            data: { status: GuestPackageStatus.EXHAUSTED },
          });
        });
        await this.publishTick(session.id);
        return false;
      }

      case "PAID_MINUTE": {
        const bonus = session.guestId
          ? bonusFor(decision.amount, session.club.bonusPercent)
          : 0;
        await this.prisma.$transaction(async (tx) => {
          if (session.guestId) {
            const walletRecord = await this.wallets.resolveWallet(
              session.guestId,
              session.clubId,
              tx,
            );
            // Расход записывается в клуб, где шла сессия, — это его выручка,
            // даже если кошелёк общий и пополняли гостя в соседнем зале.
            await this.wallets.record(tx, {
              walletId: walletRecord.id,
              clubId: session.clubId,
              amount: -decision.amount,
              type: TransactionType.SESSION_CHARGE,
              sessionId: session.id,
            });
          } else {
            // Анонимная посадка: минута уходит из предоплаты на самой сессии.
            // Движения по кошельку нет — деньги уже приняты в кассу при старте.
            await tx.session.update({
              where: { id: session.id },
              data: { prepaidRemaining: { decrement: decision.amount } },
            });
          }
          await tx.sessionSegment.update({
            where: { id: segment.id },
            data: {
              minutesUsed: { increment: 1 },
              chargedThroughMinute: { increment: 1 },
              charged: { increment: decision.amount },
            },
          });
          await tx.session.update({
            where: { id: session.id },
            data: {
              totalCharged: { increment: decision.amount },
              nextChargeAt: new Date(chargeAt.getTime() + MINUTE_MS),
            },
          });

          // Бонусы копятся с потраченного, поминутно вместе со списанием:
          // так гость видит их рост в ту же секунду, что и расход.
          if (bonus > 0) {
            await tx.guest.update({
              where: { id: session.guestId! },
              data: { bonusPoints: { increment: bonus } },
            });
          }
        });
        await this.publishTick(session.id);
        return false;
      }

      case "SWITCH_PACKAGE": {
        const pkg = await this.prisma.guestPackage.findUniqueOrThrow({
          where: { id: decision.packageId },
        });
        await this.closeAndOpenSegment(session.id, segment.id, decision.closeReason, {
          tariffId: pkg.sourceTariffId,
          kind: TariffKind.PACKAGE,
          guestPackageId: pkg.id,
        });
        this.bus.emit("session.switched", {
          clubId: session.clubId,
          computerId: session.computerId,
          sessionId: session.id,
          to: "PACKAGE",
          tariffId: pkg.sourceTariffId,
          pricePerMinute: null,
          minutesLeft: pkg.minutesRemaining,
        });
        return false;
      }

      case "SWITCH_PER_MINUTE": {
        const tariff = await this.prisma.tariff.findUniqueOrThrow({
          where: { id: decision.tariffId },
        });
        await this.closeAndOpenSegment(session.id, segment.id, decision.closeReason, {
          tariffId: tariff.id,
          kind: TariffKind.PER_MINUTE,
          guestPackageId: null,
        });
        this.bus.emit("session.switched", {
          clubId: session.clubId,
          computerId: session.computerId,
          sessionId: session.id,
          to: "PER_MINUTE",
          tariffId: tariff.id,
          pricePerMinute: tariff.pricePerMinute,
          minutesLeft: null,
        });
        return false;
      }

      case "STOP": {
        // У анонимной посадки кредита нет: деньги кончились — значит, кончилась
        // предоплата. В отчёте это должно читаться именно так.
        const reason =
          !session.guestId && decision.reason === SegmentEndReason.CREDIT_LIMIT
            ? SegmentEndReason.PREPAID_EXHAUSTED
            : decision.reason;
        await this.finish(session.id, reason);
        return true;
      }
    }
  }

  private async closeAndOpenSegment(
    sessionId: string,
    segmentId: string,
    reason: SegmentEndReason,
    next: { tariffId: string; kind: TariffKind; guestPackageId: string | null },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sessionSegment.update({
        where: { id: segmentId },
        data: { endedAt: new Date(), endReason: reason },
      });
      await tx.sessionSegment.create({
        data: {
          sessionId,
          tariffId: next.tariffId,
          kind: next.kind,
          guestPackageId: next.guestPackageId,
        },
      });
    });
  }

  // --- Завершение и управление ---

  async stopByStaff(
    staff: AuthenticatedStaff,
    clubId: string,
    sessionId: string,
  ): Promise<Session> {
    await this.access.requireClub(staff, clubId);
    return this.finish(sessionId, SegmentEndReason.STOPPED_BY_STAFF);
  }

  async finish(sessionId: string, reason: SegmentEndReason): Promise<Session> {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: { segments: { where: { endedAt: null } } },
    });

    const finished = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const segment of session.segments) {
        await tx.sessionSegment.update({
          where: { id: segment.id },
          data: { endedAt: now, endReason: reason },
        });
      }
      await tx.computer.update({
        where: { id: session.computerId },
        data: { status: ComputerStatus.IDLE },
      });
      return tx.session.update({
        where: { id: sessionId },
        data: { status: SessionStatus.FINISHED, endedAt: now, nextChargeAt: null },
      });
    });

    this.bus.emit("session.stopped", {
      clubId: session.clubId,
      computerId: session.computerId,
      sessionId,
      reason,
    });
    this.bus.emit("computer.status", {
      clubId: session.clubId,
      computerId: session.computerId,
      status: ComputerStatus.IDLE,
    });

    return finished;
  }

  async pause(staff: AuthenticatedStaff, clubId: string, sessionId: string): Promise<Session> {
    await this.access.requireClub(staff, clubId);
    const session = await this.requireSession(clubId, sessionId);
    if (session.status !== SessionStatus.ACTIVE) {
      throw new BadRequestException("Сессия не активна");
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.sessionSegment.updateMany({
        where: { sessionId, endedAt: null },
        data: { endedAt: new Date(), endReason: SegmentEndReason.PAUSED },
      });
      // Время не идёт и минуты пакета не тратятся, пока сессия на паузе.
      return tx.session.update({
        where: { id: sessionId },
        data: { status: SessionStatus.PAUSED, nextChargeAt: null },
      });
    });
  }

  async resume(staff: AuthenticatedStaff, clubId: string, sessionId: string): Promise<Session> {
    await this.access.requireClub(staff, clubId);
    const session = await this.requireSession(clubId, sessionId);
    if (session.status !== SessionStatus.PAUSED) {
      throw new BadRequestException("Сессия не на паузе");
    }

    const club = await this.prisma.club.findUniqueOrThrow({ where: { id: clubId } });
    const moment = toLocalMoment(new Date(), club.timezone);
    const packages = session.guestId
      ? await this.loadPackages(session.guestId, clubId, session.zoneId)
      : [];
    const usable = pickNextPackage(packages, session.zoneId, moment);

    let tariffId: string;
    let kind: TariffKind;
    let guestPackageId: string | null = null;

    if (usable) {
      const pkg = await this.prisma.guestPackage.findUniqueOrThrow({ where: { id: usable.id } });
      tariffId = pkg.sourceTariffId;
      kind = TariffKind.PACKAGE;
      guestPackageId = pkg.id;
    } else {
      const fallback = pickPerMinuteTariff(await this.loadPerMinuteTariffs(session.zoneId), moment);
      if (!fallback) throw new BadRequestException("В зоне нет действующего поминутного тарифа");
      tariffId = fallback.id;
      kind = TariffKind.PER_MINUTE;
    }

    const resumed = await this.prisma.$transaction(async (tx) => {
      await tx.sessionSegment.create({
        data: { sessionId, tariffId, kind, guestPackageId },
      });
      return tx.session.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.ACTIVE,
          // Возобновление тоже начинается с оплаченной минуты.
          nextChargeAt: new Date(),
        },
      });
    });

    await this.chargeOneMinute(sessionId);
    return resumed;
  }

  /**
   * Пересадка. В той же зоне отрезок не прерывается — меняется только ПК.
   * В другой зоне отрезок закрывается, а неиспользованные минуты остаются
   * на аккаунте гостя в своей зоне (docs/billing.md, раздел 6).
   */
  async move(
    staff: AuthenticatedStaff,
    clubId: string,
    sessionId: string,
    dto: MoveSessionDto,
  ): Promise<Session> {
    const club = await this.access.requireClub(staff, clubId);
    const session = await this.requireSession(clubId, sessionId);
    if (session.status !== SessionStatus.ACTIVE) {
      throw new BadRequestException("Сессия не активна");
    }

    const target = await this.prisma.computer.findUnique({ where: { id: dto.computerId } });
    if (!target || target.clubId !== clubId) throw new NotFoundException("ПК не найден");
    if (target.status === ComputerStatus.IN_USE) throw new BadRequestException("ПК занят");

    const sameZone = target.zoneId === session.zoneId;
    const previousComputerId = session.computerId;

    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.computer.update({
        where: { id: previousComputerId },
        data: { status: ComputerStatus.IDLE },
      });
      await tx.computer.update({
        where: { id: target.id },
        data: { status: ComputerStatus.IN_USE },
      });

      if (!sameZone) {
        await tx.sessionSegment.updateMany({
          where: { sessionId, endedAt: null },
          data: { endedAt: new Date(), endReason: SegmentEndReason.ZONE_CHANGE },
        });
      }

      return tx.session.update({
        where: { id: sessionId },
        data: { computerId: target.id, zoneId: target.zoneId },
      });
    });

    if (!sameZone) {
      // В новой зоне играем её пакетом гостя, если он есть, иначе её поминуткой.
      const moment = toLocalMoment(new Date(), club.timezone);
      const packages = session.guestId
        ? await this.loadPackages(session.guestId, clubId, target.zoneId)
        : [];
      const usable = pickNextPackage(packages, target.zoneId, moment);

      if (usable) {
        const pkg = await this.prisma.guestPackage.findUniqueOrThrow({ where: { id: usable.id } });
        await this.prisma.sessionSegment.create({
          data: {
            sessionId,
            tariffId: pkg.sourceTariffId,
            kind: TariffKind.PACKAGE,
            guestPackageId: pkg.id,
          },
        });
      } else {
        const fallback = pickPerMinuteTariff(
          await this.loadPerMinuteTariffs(target.zoneId),
          moment,
        );
        if (!fallback) throw new BadRequestException("В целевой зоне нет поминутного тарифа");
        await this.prisma.sessionSegment.create({
          data: { sessionId, tariffId: fallback.id, kind: TariffKind.PER_MINUTE },
        });
      }
    }

    this.bus.emit("computer.status", {
      clubId,
      computerId: previousComputerId,
      status: ComputerStatus.IDLE,
    });
    this.bus.emit("computer.status", {
      clubId,
      computerId: target.id,
      status: ComputerStatus.IN_USE,
    });

    return moved;
  }

  // --- Карта зала ---

  async hallMap(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);

    const computers = await this.prisma.computer.findMany({
      where: { clubId },
      orderBy: { name: "asc" },
      include: {
        zone: { select: { id: true, name: true } },
        sessions: {
          where: { status: { in: [SessionStatus.ACTIVE, SessionStatus.PAUSED] } },
          include: {
            guest: { select: { id: true, fullName: true, phone: true } },
            segments: { orderBy: { startedAt: "desc" }, take: 1 },
          },
        },
      },
    });

    const club = await this.prisma.club.findUniqueOrThrow({ where: { id: clubId } });

    return Promise.all(
      computers.map(async (computer) => {
        const session = computer.sessions[0] ?? null;
        if (!session) {
          return { computer: this.publicComputer(computer), session: null };
        }

        // У анонимной посадки роль баланса играет остаток предоплаты.
        const wallet = session.guestId
          ? await this.walletState(session.guestId, clubId, club.creditLimit)
          : session.prepaidRemaining !== null
            ? { balance: session.prepaidRemaining, creditLimit: 0 }
            : null;
        const segment = session.segments[0] ?? null;
        const pkg = segment?.guestPackageId
          ? await this.prisma.guestPackage.findUnique({ where: { id: segment.guestPackageId } })
          : null;

        const tariff = segment
          ? await this.prisma.tariff.findUnique({ where: { id: segment.tariffId } })
          : null;
        const price = tariff?.pricePerMinute ?? 0;

        return {
          computer: this.publicComputer(computer),
          session: {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt,
            startedBy: session.startedBy,
            totalCharged: session.totalCharged,
            guest: session.guest,
            mode: segment?.kind ?? null,
            packageMinutesLeft: pkg?.minutesRemaining ?? null,
            balance: wallet?.balance ?? null,
            creditLeft: wallet ? creditLeft(wallet) : null,
            minutesAffordable: wallet && price > 0 ? minutesAffordable(wallet, price) : null,
            /** Гость ушёл в минус — админу стоит подойти и предложить пополнение. */
            onCredit: wallet !== null && wallet.balance < 0,
          },
        };
      }),
    );
  }

  private publicComputer(computer: {
    id: string;
    name: string;
    status: ComputerStatus;
    zone: { id: string; name: string };
    lastSeenAt: Date | null;
    posX: number | null;
    posY: number | null;
  }) {
    return {
      id: computer.id,
      name: computer.name,
      status: computer.status,
      zone: computer.zone,
      lastSeenAt: computer.lastSeenAt,
      // Место на плане: где машина стоит в помещении, а не по алфавиту.
      posX: computer.posX,
      posY: computer.posY,
    };
  }

  // --- Загрузка состояния для правил ---

  private async loadPackages(
    guestId: string,
    clubId: string,
    zoneId: string,
  ): Promise<PackageState[]> {
    const packages = await this.prisma.guestPackage.findMany({
      where: {
        guestId,
        clubId,
        zoneId,
        status: { in: [GuestPackageStatus.ACTIVE, GuestPackageStatus.EXHAUSTED] },
      },
      orderBy: { expiresAt: "asc" },
    });

    return packages.map((p) => ({
      id: p.id,
      zoneId: p.zoneId,
      minutesRemaining: p.minutesRemaining,
      expiresAt: p.expiresAt,
    }));
  }

  private async loadPerMinuteTariffs(zoneId: string): Promise<PerMinuteTariffState[]> {
    const tariffs = await this.prisma.tariff.findMany({
      where: { zoneId, kind: TariffKind.PER_MINUTE, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    return tariffs.map((t) => ({
      id: t.id,
      pricePerMinute: t.pricePerMinute ?? 0,
      activeFromMinute: t.activeFromMinute,
      activeToMinute: t.activeToMinute,
      daysOfWeek: t.daysOfWeek,
    }));
  }

  private async walletState(
    guestId: string,
    clubId: string,
    creditLimit: number,
  ): Promise<WalletState> {
    const wallet = await this.wallets.resolveWallet(guestId, clubId);
    return { balance: wallet.balance, creditLimit };
  }

  private async requireSession(clubId: string, sessionId: string): Promise<Session> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.clubId !== clubId) throw new NotFoundException("Сессия не найдена");
    return session;
  }

  /**
   * Состояние сессии для экрана гостя.
   *
   * Нужно не только для регулярных тиков: агент, подключившийся при уже идущей
   * сессии (перезапуск, обновление Windows), обязан узнать о ней сразу, иначе
   * до минуты держит экран блокировки поверх оплаченной игры.
   */
  async sessionSnapshot(sessionId: string): Promise<{
    clubId: string;
    computerId: string;
    sessionId: string;
    packageMinutesLeft: number | null;
    balance: number;
    minutesAffordable: number | null;
    creditLeft: number | null;
    accruedCost: number;
  } | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        club: true,
        segments: { orderBy: { startedAt: "desc" }, take: 1 },
      },
    });
    if (!session) return null;

    const segment = session.segments[0] ?? null;
    const pkg = segment?.guestPackageId
      ? await this.prisma.guestPackage.findUnique({ where: { id: segment.guestPackageId } })
      : null;
    const wallet = session.guestId
      ? await this.walletState(session.guestId, session.clubId, session.club.creditLimit)
      : session.prepaidRemaining !== null
        ? { balance: session.prepaidRemaining, creditLimit: 0 }
        : null;
    const tariff = segment
      ? await this.prisma.tariff.findUnique({ where: { id: segment.tariffId } })
      : null;
    const price = tariff?.pricePerMinute ?? 0;

    return {
      clubId: session.clubId,
      computerId: session.computerId,
      sessionId: session.id,
      packageMinutesLeft: pkg?.minutesRemaining ?? null,
      balance: wallet?.balance ?? 0,
      minutesAffordable: wallet && price > 0 ? minutesAffordable(wallet, price) : null,
      creditLeft: wallet ? creditLeft(wallet) : null,
      accruedCost: session.totalCharged,
    };
  }

  /** Активная сессия машины — для агента, подключившегося посреди игры. */
  async activeSessionFor(computerId: string): Promise<string | null> {
    const session = await this.prisma.session.findFirst({
      where: { computerId, status: SessionStatus.ACTIVE },
      select: { id: true },
    });
    return session?.id ?? null;
  }

  /**
   * Агент вернулся на связь. Срок списания сдвигается на текущий момент:
   * накопившееся за молчание не начисляется, потому что не подтверждено.
   * Реально отыгранное придёт отдельным отчётом агента.
   */
  async resumeAfterSilence(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, nextChargeAt: true },
    });
    if (!session || session.status !== SessionStatus.ACTIVE) return;

    const now = new Date();
    if (session.nextChargeAt && session.nextChargeAt < now) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { nextChargeAt: now },
      });
    }
  }

  /**
   * Списание минут, подтверждённых агентом за время без связи.
   *
   * Отматываем срок назад ровно на отчитанные минуты и отдаём работу обычному
   * движку: он применит те же правила, что и онлайн, включая тарифы по времени
   * суток и остановку на кредитном лимите.
   */
  async chargeConfirmedMinutes(sessionId: string, minutes: number): Promise<void> {
    if (minutes <= 0) return;

    /*
     * Отматываем на (minutes − 1): движок списывает и в начальный момент, и в
     * конечный, поэтому сдвиг ровно на minutes дал бы на минуту больше.
     * Для одной минуты срок совпадает с текущим моментом — одно списание.
     */
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { nextChargeAt: new Date(Date.now() - (minutes - 1) * MINUTE_MS) },
    });
    await this.chargeOneMinute(sessionId);
  }

  private async publishTick(sessionId: string): Promise<void> {
    const snapshot = await this.sessionSnapshot(sessionId);
    if (snapshot) this.bus.emit("session.tick", snapshot);
  }
}

export type SessionsTransaction = Prisma.TransactionClient;
