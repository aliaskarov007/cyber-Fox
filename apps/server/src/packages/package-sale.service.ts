import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { type Club, GuestPackageStatus, PackageFormat, type Prisma, type Tariff } from "@prisma/client";

import { toLocalMoment } from "../common/local-time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  type RolloverSettings,
  insideWindow,
  minutesUntilWindowEnd,
  packageTotalMinutes,
  rolloverMinutes,
} from "./package.rules.js";

type Db = Prisma.TransactionClient | PrismaService;

export function rolloverSettings(club: Club): RolloverSettings {
  return {
    percent: club.rolloverPercent,
    streakPercent: club.rolloverStreakPercent,
    capPercent: club.rolloverCapPercent,
    renewBeforeDays: club.renewBeforeDays,
    renewAfterDays: club.renewAfterDays,
  };
}

/** «22:00» из минут суток — для сообщений на стойке. */
function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * Продажа пакета по его формату (docs/billing.md, раздел 4.6).
 *
 * - «N+M»: оплаченные минуты плюс подарочные.
 * - Ночной: продаётся только внутри окна и длится ровно до его конца.
 * - Абонемент: если гость продлевает прежний вовремя, часть остатка прежнего
 *   переезжает в новый. Продлил заранее — перенос случится, когда прежний
 *   кончится (PackageRolloverWorker); продлил после окончания — сразу.
 *
 * Окно времени у любого пакета — это окно продажи: «2+1 днём» нельзя купить
 * вечером.
 */
@Injectable()
export class PackageSaleService {
  private readonly logger = new Logger(PackageSaleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Минуты и срок нового пакета. Бросает понятную ошибку, если продать сейчас нельзя. */
  terms(club: Club, tariff: Tariff, now: Date): { minutes: number; expiresAt: Date } {
    const window =
      tariff.activeFromMinute !== null && tariff.activeToMinute !== null
        ? { from: tariff.activeFromMinute, to: tariff.activeToMinute }
        : null;
    const moment = toLocalMoment(now, club.timezone);

    if (window && !insideWindow(moment.minuteOfDay, window)) {
      throw new BadRequestException(
        `«${tariff.name}» продаётся с ${hhmm(window.from)} до ${hhmm(window.to)}`,
      );
    }

    if (tariff.packageFormat === PackageFormat.NIGHT) {
      if (!window) throw new BadRequestException(`У ночного пакета «${tariff.name}» не задано окно`);
      const minutes = minutesUntilWindowEnd(moment.minuteOfDay, window);
      return { minutes, expiresAt: new Date(now.getTime() + minutes * 60_000) };
    }

    if (!tariff.packageMinutes) throw new BadRequestException("У тарифа не заданы минуты");
    const validityDays = tariff.validityDays ?? club.packageValidityDays;
    return {
      minutes: packageTotalMinutes(tariff.packageMinutes, tariff.bonusMinutes),
      expiresAt: new Date(now.getTime() + validityDays * 86_400_000),
    };
  }

  /**
   * Прежний абонемент гостя в этом зале, который новая покупка продлевает.
   * Пакеты по сети не ходят (docs/billing.md, 9.2), поэтому ищем только здесь.
   */
  async renewedSubscription(db: Db, club: Club, guestId: string, now: Date) {
    const day = 86_400_000;
    return db.guestPackage.findFirst({
      where: {
        guestId,
        clubId: club.id,
        status: { not: GuestPackageStatus.REFUNDED },
        renewedById: null,
        rolledOverAt: null,
        sourceTariff: { packageFormat: PackageFormat.SUBSCRIPTION },
        expiresAt: {
          gte: new Date(now.getTime() - club.renewAfterDays * day),
          lte: new Date(now.getTime() + club.renewBeforeDays * day),
        },
      },
      orderBy: { expiresAt: "desc" },
    });
  }

  /**
   * Перенести остаток прежнего абонемента в новый. Вызывается при продлении
   * после окончания и воркером — для продлённых заранее, когда прежний кончился.
   * Возвращает, сколько минут переехало.
   */
  async settle(db: Db, oldId: string, now: Date): Promise<number> {
    const old = await db.guestPackage.findUnique({ where: { id: oldId }, include: { club: true } });
    if (!old || !old.renewedById || old.rolledOverAt) return 0;

    const next = await db.guestPackage.findUnique({ where: { id: old.renewedById } });
    // Отметка ставится в любом случае: пересчитывать один и тот же абонемент
    // на каждом проходе воркера незачем.
    await db.guestPackage.update({ where: { id: old.id }, data: { rolledOverAt: now } });
    if (!next || next.status === GuestPackageStatus.REFUNDED || next.expiresAt <= now) return 0;

    const minutes = rolloverMinutes(
      {
        minutesTotal: old.minutesTotal,
        minutesRemaining: old.minutesRemaining,
        carriedMinutes: old.carriedMinutes,
        pricePaid: old.pricePaid,
        expiresAt: old.expiresAt,
      },
      { paidMinutes: next.minutesTotal - next.carriedMinutes, pricePaid: next.pricePaid, streak: next.streak },
      rolloverSettings(old.club),
    );
    if (minutes <= 0) return 0;

    await db.guestPackage.update({
      where: { id: next.id },
      data: {
        minutesTotal: { increment: minutes },
        minutesRemaining: { increment: minutes },
        carriedMinutes: { increment: minutes },
        carriedFromId: old.id,
        // Исчерпанный абонемент снова в деле: минуты появились.
        ...(next.status === GuestPackageStatus.EXHAUSTED ? { status: GuestPackageStatus.ACTIVE } : {}),
      },
    });
    this.logger.log(`Перенесено ${minutes} мин с абонемента ${old.id} на ${next.id}`);
    return minutes;
  }
}
