import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma, PromoKind, WinbackStatus } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { SEND_BATCH, SEND_PAUSE_MS } from "../events/events.rules.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { generatePromoCode } from "../promos/promo.rules.js";
import { WhatsAppService } from "../whatsapp/whatsapp.service.js";
import {
  DEFAULT_MESSAGE,
  type GuestVisitStats,
  type RetentionOptions,
  type RetentionStatus,
  churnByMonth,
  classify,
  isRegular,
  lastMonths,
  messageBlocker,
  monthlySpend,
  partOfDay,
  recentlyContacted,
  renderMessage,
} from "./retention.rules.js";
import type { CreateWinbackDto } from "./retention.dto.js";

/** Сколько истории смотреть. Год — чтобы увидеть и тех, кто ушёл давно. */
const LOOKBACK_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionGuest {
  guestId: string;
  fullName: string;
  phone: string;
  status: RetentionStatus;
  visits: number;
  spent: number;
  /** Сколько приносил в месяц, пока ходил. */
  monthlySpend: number;
  firstAt: Date;
  lastAt: Date;
  daysSince: number;
  /** Обычный промежуток между визитами, дней. */
  rhythmDays: number | null;
  usualZone: string | null;
  usualTime: string | null;
  /** Написать можно: номер подтверждён и гость не отписывался. */
  reachable: boolean;
  /** Почему писать нельзя или не стоит прямо сейчас. */
  blockedReason: string | null;
  lastWinbackAt: Date | null;
}

export interface RetentionReport {
  options: RetentionOptions;
  totals: {
    regulars: number;
    active: number;
    atRisk: number;
    lost: number;
    /** Сколько в месяц приносили ушедшие — цена оттока. */
    lostMonthlySpend: number;
    atRiskMonthlySpend: number;
  };
  byMonth: Array<{ month: string; guests: number; monthlySpend: number }>;
  /** Ушедшие и под угрозой, самые ценные сверху. */
  guests: RetentionGuest[];
  whatsappConnected: boolean;
}

interface StatsRow {
  guestId: string;
  visits: number;
  spent: bigint | number;
  firstAt: Date;
  lastAt: Date;
  medianGap: number | null;
  zoneId: string | null;
  hour: number | null;
}

/**
 * Отток гостей зала и возврат ушедших личными промокодами.
 *
 * Считается только по своим данным: визиты и траты гостя в этом зале. Куда
 * гость ушёл, система не знает и знать не пытается — зато видно, кто пропал,
 * сколько он приносил и вернулся ли после сообщения.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async report(
    staff: AuthenticatedStaff,
    clubId: string,
    options: RetentionOptions,
  ): Promise<RetentionReport> {
    const club = await this.access.requireClub(staff, clubId);
    const now = new Date();
    const stats = await this.visitStats(clubId, club.timezone, now);

    const regulars = stats.filter((s) => isRegular(s, options));
    const classified = regulars.map((s) => ({ stats: s, ...classify(s, now, options) }));
    const leaving = classified.filter((c) => c.status !== "active");

    const ids = leaving.map((c) => c.stats.guestId);
    const [guests, zones, lastWinbacks, channel] = await Promise.all([
      this.prisma.guest.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true, phone: true, phoneVerifiedAt: true, invitesOptOutAt: true },
      }),
      this.prisma.zone.findMany({ where: { clubId }, select: { id: true, name: true } }),
      this.prisma.winbackMessage.groupBy({
        by: ["guestId"],
        where: { guestId: { in: ids }, status: WinbackStatus.SENT, campaign: { clubId } },
        _max: { sentAt: true },
      }),
      this.prisma.whatsAppChannel.findUnique({ where: { tenantId: staff.tenantId } }),
    ]);
    const guestById = new Map(guests.map((g) => [g.id, g]));
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const lastSent = new Map(lastWinbacks.map((w) => [w.guestId, w._max.sentAt]));

    const rows: RetentionGuest[] = [];
    for (const item of leaving) {
      const guest = guestById.get(item.stats.guestId);
      if (!guest) continue;
      const lastWinbackAt = lastSent.get(guest.id) ?? null;
      const blockedReason = !guest.phoneVerifiedAt
        ? "номер не подтверждён"
        : guest.invitesOptOutAt
          ? "отписался от сообщений"
          : recentlyContacted(lastWinbackAt, now)
            ? "уже писали в этом месяце"
            : null;
      rows.push({
        guestId: guest.id,
        fullName: guest.fullName,
        phone: guest.phone,
        status: item.status,
        visits: item.stats.visits,
        spent: item.stats.spent,
        monthlySpend: monthlySpend(item.stats),
        firstAt: item.stats.firstAt,
        lastAt: item.stats.lastAt,
        daysSince: item.daysSince,
        rhythmDays: item.stats.medianGapDays === null ? null : Math.round(item.stats.medianGapDays * 10) / 10,
        usualZone: item.stats.zoneId ? (zoneName.get(item.stats.zoneId) ?? null) : null,
        usualTime: partOfDay(item.stats.usualHour),
        reachable: Boolean(guest.phoneVerifiedAt) && !guest.invitesOptOutAt,
        blockedReason,
        lastWinbackAt,
      });
    }
    rows.sort((a, b) => b.monthlySpend - a.monthlySpend);

    const lost = rows.filter((r) => r.status === "lost");
    const atRisk = rows.filter((r) => r.status === "at_risk");
    const sum = (list: RetentionGuest[]): number => list.reduce((s, r) => s + r.monthlySpend, 0);

    return {
      options,
      totals: {
        regulars: regulars.length,
        active: classified.length - leaving.length,
        atRisk: atRisk.length,
        lost: lost.length,
        lostMonthlySpend: sum(lost),
        atRiskMonthlySpend: sum(atRisk),
      },
      byMonth: churnByMonth(lost, lastMonths(now, club.timezone, 6), club.timezone),
      guests: rows,
      whatsappConnected: channel !== null,
    };
  }

  /**
   * Визиты и траты гостей зала одним запросом. Обычный промежуток между
   * визитами считает сама база: тянуть год сессий в память ради медианы
   * незачем.
   */
  private async visitStats(
    clubId: string,
    timezone: string,
    now: Date,
  ): Promise<Array<GuestVisitStats & { zoneId: string | null }>> {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);

    const rows = await this.prisma.$queryRaw<StatsRow[]>(Prisma.sql`
      WITH v AS (
        SELECT s."guestId", s."startedAt", s."totalCharged", s."zoneId",
          EXTRACT(HOUR FROM (s."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::int AS hour,
          EXTRACT(EPOCH FROM s."startedAt" - LAG(s."startedAt")
            OVER (PARTITION BY s."guestId" ORDER BY s."startedAt")) / 86400.0 AS gap
        FROM "Session" s
        WHERE s."clubId" = ${clubId}
          AND s."guestId" IS NOT NULL
          AND s."startedAt" >= ${since}
          AND s."status" <> 'CANCELLED'
      )
      SELECT "guestId",
        COUNT(*)::int AS "visits",
        COALESCE(SUM("totalCharged"), 0)::bigint AS "spent",
        MIN("startedAt") AS "firstAt",
        MAX("startedAt") AS "lastAt",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS "medianGap",
        mode() WITHIN GROUP (ORDER BY "zoneId") AS "zoneId",
        mode() WITHIN GROUP (ORDER BY hour) AS "hour"
      FROM v
      GROUP BY "guestId"`);

    // Бар — тоже деньги гостя: заказы с ПК и со стойки на его аккаунт.
    const bar = await this.prisma.productSale.groupBy({
      by: ["guestId"],
      where: { clubId, guestId: { not: null }, createdAt: { gte: since } },
      _sum: { total: true },
    });
    const barByGuest = new Map(bar.map((b) => [b.guestId!, b._sum.total ?? 0]));

    return rows.map((r) => ({
      guestId: r.guestId,
      visits: Number(r.visits),
      spent: Number(r.spent) + (barByGuest.get(r.guestId) ?? 0),
      firstAt: new Date(r.firstAt),
      lastAt: new Date(r.lastAt),
      medianGapDays: r.medianGap === null ? null : Number(r.medianGap),
      usualHour: r.hour === null ? null : Number(r.hour),
      zoneId: r.zoneId,
    }));
  }

  /**
   * Рассылка выбранным гостям: каждому — личный промокод, текст уходит в
   * очередь. Кому писать нельзя (номер не подтверждён, отписался, уже писали
   * в этом месяце), тех пропускаем и говорим, сколько их.
   */
  async createCampaign(staff: AuthenticatedStaff, clubId: string, dto: CreateWinbackDto) {
    const club = await this.access.requireClub(staff, clubId);
    await this.whatsapp.requireChannel(staff.tenantId);

    const template = dto.message?.trim() || DEFAULT_MESSAGE;
    const blocker = messageBlocker(template);
    if (blocker) throw new BadRequestException(blocker);

    const now = new Date();
    const guests = await this.prisma.guest.findMany({
      where: { id: { in: [...new Set(dto.guestIds)] }, tenantId: staff.tenantId },
      select: { id: true, phoneVerifiedAt: true, invitesOptOutAt: true },
    });
    const lastWinbacks = await this.prisma.winbackMessage.groupBy({
      by: ["guestId"],
      where: { guestId: { in: guests.map((g) => g.id) }, status: { not: WinbackStatus.FAILED }, campaign: { clubId } },
      _max: { createdAt: true },
    });
    const lastSent = new Map(lastWinbacks.map((w) => [w.guestId, w._max.createdAt]));

    const eligible = guests.filter(
      (g) => g.phoneVerifiedAt && !g.invitesOptOutAt && !recentlyContacted(lastSent.get(g.id) ?? null, now),
    );
    if (eligible.length === 0) {
      throw new BadRequestException(
        "Из выбранных писать некому: номера не подтверждены, гости отписались или им уже писали в этом месяце",
      );
    }

    const expiresAt = new Date(now.getTime() + dto.validDays * DAY_MS);

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.winbackCampaign.create({
        data: {
          tenantId: staff.tenantId,
          clubId: club.id,
          createdById: staff.id,
          kind: dto.kind,
          amount: dto.amount,
          validDays: dto.validDays,
          message: template,
        },
      });

      for (const guest of eligible) {
        const promo = await this.createPersonalCode(tx, {
          tenantId: staff.tenantId,
          clubId: club.id,
          guestId: guest.id,
          kind: dto.kind,
          amount: dto.amount,
          expiresAt,
          createdById: staff.id,
        });
        await tx.winbackMessage.create({
          data: { campaignId: created.id, guestId: guest.id, promoId: promo.id },
        });
      }
      return created;
    });

    return {
      campaignId: campaign.id,
      queued: eligible.length,
      skipped: dto.guestIds.length - eligible.length,
    };
  }

  /** Личный одноразовый код. Совпадение со случайным кодом — повод взять другой. */
  private async createPersonalCode(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      clubId: string;
      guestId: string;
      kind: PromoKind;
      amount: number;
      expiresAt: Date;
      createdById: string;
    },
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generatePromoCode(8);
      const taken = await tx.promoCode.findUnique({
        where: { tenantId_code: { tenantId: params.tenantId, code } },
        select: { id: true },
      });
      if (taken) continue;
      return tx.promoCode.create({
        data: {
          tenantId: params.tenantId,
          clubId: params.clubId,
          guestId: params.guestId,
          code,
          kind: params.kind,
          amount: params.amount,
          maxUses: 1,
          expiresAt: params.expiresAt,
          comment: "Возврат ушедшего гостя",
          createdById: params.createdById,
        },
      });
    }
    throw new BadRequestException("Не удалось подобрать свободный код — попробуйте ещё раз");
  }

  /**
   * Итоги рассылок: сколько ушло, сколько ввели код, сколько вернулись и
   * сколько принесли после возврата. «Вернулся» — была игра в этом зале после
   * сообщения, с кодом или без.
   */
  async campaigns(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);
    const campaigns = await this.prisma.winbackCampaign.findMany({
      where: { clubId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        messages: {
          select: {
            guestId: true,
            status: true,
            sentAt: true,
            promo: { select: { usedCount: true } },
          },
        },
      },
    });

    return Promise.all(
      campaigns.map(async (campaign) => {
        const sent = campaign.messages.filter((m) => m.status === WinbackStatus.SENT);
        const returned = await this.returnedAfter(clubId, sent);
        return {
          id: campaign.id,
          createdAt: campaign.createdAt,
          kind: campaign.kind,
          amount: campaign.amount,
          validDays: campaign.validDays,
          total: campaign.messages.length,
          pending: campaign.messages.filter((m) => m.status === WinbackStatus.PENDING).length,
          sent: sent.length,
          failed: campaign.messages.filter((m) => m.status === WinbackStatus.FAILED).length,
          redeemed: campaign.messages.filter((m) => m.promo.usedCount > 0).length,
          returned: returned.guests,
          revenueAfter: returned.revenue,
        };
      }),
    );
  }

  /** Кто из получивших сообщение снова играл в зале и сколько потратил после. */
  private async returnedAfter(
    clubId: string,
    sent: Array<{ guestId: string; sentAt: Date | null }>,
  ): Promise<{ guests: number; revenue: number }> {
    if (sent.length === 0) return { guests: 0, revenue: 0 };
    const sessions = await this.prisma.session.findMany({
      where: {
        clubId,
        guestId: { in: sent.map((m) => m.guestId) },
        startedAt: { gte: new Date(Math.min(...sent.map((m) => m.sentAt?.getTime() ?? Date.now()))) },
        status: { not: "CANCELLED" },
      },
      select: { guestId: true, startedAt: true, totalCharged: true },
    });
    const sentAt = new Map(sent.map((m) => [m.guestId, m.sentAt?.getTime() ?? Infinity]));
    const back = new Set<string>();
    let revenue = 0;
    for (const s of sessions) {
      if (s.startedAt.getTime() < (sentAt.get(s.guestId!) ?? Infinity)) continue;
      back.add(s.guestId!);
      revenue += s.totalCharged;
    }
    return { guests: back.size, revenue };
  }

  /**
   * Один проход очереди сообщений. Вызывается воркером вне запроса, поэтому
   * каждое сообщение уходит от имени своей сети.
   */
  async processQueue(): Promise<number> {
    const batch = await this.prisma.winbackMessage.findMany({
      where: { status: WinbackStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: SEND_BATCH,
      include: {
        guest: { select: { fullName: true, phone: true, invitesOptOutAt: true } },
        promo: { select: { code: true, kind: true, amount: true, expiresAt: true, disabledAt: true } },
        campaign: {
          select: {
            tenantId: true,
            message: true,
            club: { select: { name: true, timezone: true } },
          },
        },
      },
    });

    let processed = 0;
    for (const item of batch) {
      const { guest, promo, campaign } = item;
      // Гость мог ответить «СТОП» на другое сообщение, пока это ждало очереди.
      const skip = guest.invitesOptOutAt
        ? "Гость отписался от сообщений"
        : promo.disabledAt
          ? "Промокод отключён"
          : null;
      if (skip) {
        await this.prisma.winbackMessage.update({
          where: { id: item.id },
          data: { status: WinbackStatus.FAILED, error: skip },
        });
        continue;
      }

      const text = renderMessage(campaign.message, {
        name: guest.fullName,
        club: campaign.club.name,
        gift: giftText(promo.kind, promo.amount),
        code: promo.code,
        until: promo.expiresAt
          ? promo.expiresAt.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              timeZone: campaign.club.timezone,
            })
          : "конца месяца",
      });

      const result = await this.whatsapp.send(campaign.tenantId, guest.phone, text);
      await this.prisma.winbackMessage.update({
        where: { id: item.id },
        data: result.ok
          ? { status: WinbackStatus.SENT, sentAt: new Date(), providerMessageId: result.messageId, error: null }
          : { status: WinbackStatus.FAILED, error: result.error },
      });
      if (!result.ok) this.logger.warn(`Сообщение ${item.id} не ушло: ${result.error}`);

      processed += 1;
      await sleep(SEND_PAUSE_MS);
    }
    return processed;
  }
}

/** «1 000 ₸ на счёт» или «1 000 бонусов». */
export function giftText(kind: PromoKind, amount: number): string {
  const tenge = (amount / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return kind === PromoKind.BALANCE ? `${tenge} ₸ на счёт` : `${tenge} бонусов`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
