import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PromoKind, StaffRole, TransactionType } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { SessionsService } from "../sessions/sessions.service.js";
import {
  AttemptLimiter,
  PROMO_CODE_PATTERN,
  generatePromoCode,
  normalizePromoCode,
  promoBlocker,
} from "./promo.rules.js";
import type { CreatePromoDto } from "./promos.dto.js";

/** Пять промахов за десять минут — и ввод с этой машины или этим гостем на паузе. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60_000;

export interface PromoListItem {
  id: string;
  code: string;
  kind: PromoKind;
  amount: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  comment: string | null;
  /** null — код действует во всех залах сети. */
  clubId: string | null;
  clubName: string | null;
  disabledAt: Date | null;
  createdAt: Date;
}

export interface RedeemResult {
  code: string;
  kind: PromoKind;
  amount: number;
  /** Баланс кошелька гостя в этом клубе после зачисления. */
  balance: number;
  bonusPoints: number;
}

/** Ответ игровому ПК: отказ объясняется словами, как и при входе. */
export type ComputerRedeemResult =
  | ({ ok: true; reason: null } & RedeemResult)
  | { ok: false; reason: string };

/**
 * Промокоды: владелец или управляющий заводит код, гость вводит его сам за
 * игровым ПК или называет администратору на стойке.
 *
 * Деньги по промокоду — не платёж: в кассу смены они не попадают, иначе сверка
 * показывала бы недостачу на каждую раздачу. На счёте гостя они видны отдельной
 * строкой «Промокод».
 */
@Injectable()
export class PromosService {
  private readonly logger = new Logger(PromosService.name);
  private readonly limiter = new AttemptLimiter(MAX_FAILURES, FAILURE_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
    private readonly sessions: SessionsService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Коды, действующие в зале: его собственные и общие на сеть. */
  async list(staff: AuthenticatedStaff, clubId: string): Promise<PromoListItem[]> {
    await this.access.requireClub(staff, clubId);
    const promos = await this.prisma.promoCode.findMany({
      where: { tenantId: staff.tenantId, OR: [{ clubId }, { clubId: null }] },
      include: { club: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return promos.map((p) => ({
      id: p.id,
      code: p.code,
      kind: p.kind,
      amount: p.amount,
      maxUses: p.maxUses,
      usedCount: p.usedCount,
      expiresAt: p.expiresAt,
      comment: p.comment,
      clubId: p.clubId,
      clubName: p.club?.name ?? null,
      disabledAt: p.disabledAt,
      createdAt: p.createdAt,
    }));
  }

  async create(staff: AuthenticatedStaff, clubId: string, dto: CreatePromoDto) {
    await this.access.requireClub(staff, clubId);

    // Код на всю сеть раздаёт деньги чужих залов — это решение владельца.
    if (dto.networkWide && staff.role !== StaffRole.OWNER) {
      throw new ForbiddenException("Код для всей сети заводит владелец");
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Срок действия уже прошёл");
    }

    const wanted = dto.code?.trim() ? normalizePromoCode(dto.code) : null;
    if (wanted !== null && !PROMO_CODE_PATTERN.test(wanted)) {
      throw new BadRequestException("Код — от 4 до 20 латинских букв и цифр");
    }

    // Сгенерированный код может совпасть с существующим — пробуем ещё раз.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = wanted ?? generatePromoCode(8);
      try {
        return await this.prisma.promoCode.create({
          data: {
            tenantId: staff.tenantId,
            clubId: dto.networkWide ? null : clubId,
            code,
            kind: dto.kind,
            amount: dto.amount,
            maxUses: dto.maxUses ?? null,
            expiresAt,
            comment: dto.comment?.trim() || null,
            createdById: staff.id,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (wanted !== null) throw new BadRequestException(`Код ${wanted} уже заведён`);
      }
    }
    throw new BadRequestException("Не удалось подобрать свободный код — попробуйте ещё раз");
  }

  /** Отключить код. Уже начисленное гостям остаётся у них. */
  async disable(staff: AuthenticatedStaff, clubId: string, promoId: string) {
    await this.access.requireClub(staff, clubId);
    const promo = await this.requirePromo(staff, clubId, promoId);
    if (promo.clubId === null && staff.role !== StaffRole.OWNER) {
      throw new ForbiddenException("Код для всей сети отключает владелец");
    }
    return this.prisma.promoCode.update({
      where: { id: promo.id },
      data: { disabledAt: promo.disabledAt ?? new Date() },
    });
  }

  /** Кто воспользовался кодом: разбор «мне не начислили» и оценка акции. */
  async redemptions(staff: AuthenticatedStaff, clubId: string, promoId: string) {
    await this.access.requireClub(staff, clubId);
    const promo = await this.requirePromo(staff, clubId, promoId);
    const list = await this.prisma.promoRedemption.findMany({
      where: { promoId: promo.id },
      include: { guest: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return list.map((r) => ({
      id: r.id,
      guest: r.guest,
      amount: r.amount,
      kind: r.kind,
      atComputer: r.computerId !== null,
      createdAt: r.createdAt,
    }));
  }

  /** Администратор вводит код, названный гостем на стойке. */
  async redeemAtDesk(
    staff: AuthenticatedStaff,
    clubId: string,
    guestId: string,
    rawCode: string,
  ): Promise<RedeemResult> {
    await this.access.requireClub(staff, clubId);
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.tenantId !== staff.tenantId) throw new NotFoundException("Гость не найден");

    const result = await this.redeem({
      tenantId: staff.tenantId,
      clubId,
      guestId,
      rawCode,
      staffId: staff.id,
      computerId: null,
    }).catch((error: unknown) => {
      throw error instanceof PromoNotFound ? new BadRequestException(error.message) : error;
    });
    await this.pushToSeat(guestId, clubId);
    return result;
  }

  /**
   * Гость вводит код сам за игровым ПК. Промахи считаются и по машине, и по
   * гостю: перебор не обходится ни пересадкой, ни сменой аккаунта.
   */
  async redeemAtComputer(
    computerId: string,
    guestId: string,
    rawCode: string,
  ): Promise<ComputerRedeemResult> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { clubId: true, club: { select: { tenantId: true } } },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };

    const now = Date.now();
    const keys = [`pc:${computerId}`, `guest:${guestId}`];
    if (keys.some((key) => this.limiter.blocked(key, now))) {
      return {
        ok: false,
        reason: "Слишком много неверных кодов. Попробуйте через несколько минут или подойдите к администратору.",
      };
    }

    try {
      const result = await this.redeem({
        tenantId: computer.club.tenantId,
        clubId: computer.clubId,
        guestId,
        rawCode,
        staffId: null,
        computerId,
      });
      return { ok: true, reason: null, ...result };
    } catch (error) {
      if (error instanceof PromoNotFound) {
        for (const key of keys) this.limiter.fail(key, now);
      }
      if (error instanceof BadRequestException || error instanceof PromoNotFound) {
        return { ok: false, reason: error.message };
      }
      this.logger.error("Промокод не применился", error as Error);
      return { ok: false, reason: "Не удалось применить промокод" };
    }
  }

  /**
   * Применение кода. Счётчик использований поднимается условным UPDATE: два
   * гостя, вводящие последний экземпляр одновременно, не получат оба.
   */
  private async redeem(params: {
    tenantId: string;
    clubId: string;
    guestId: string;
    rawCode: string;
    staffId: string | null;
    computerId: string | null;
  }): Promise<RedeemResult> {
    const code = normalizePromoCode(params.rawCode);
    if (!PROMO_CODE_PATTERN.test(code)) throw new PromoNotFound();

    const promo = await this.prisma.promoCode.findUnique({
      where: { tenantId_code: { tenantId: params.tenantId, code } },
    });
    if (!promo) throw new PromoNotFound();

    const blocker = promoBlocker(promo, params.clubId, new Date());
    if (blocker) throw new BadRequestException(blocker);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const taken = await tx.$executeRaw`
          UPDATE "PromoCode"
          SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
          WHERE "id" = ${promo.id}
            AND "disabledAt" IS NULL
            AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
        if (taken === 0) throw new BadRequestException("Промокод уже разобрали");

        await tx.promoRedemption.create({
          data: {
            tenantId: params.tenantId,
            promoId: promo.id,
            guestId: params.guestId,
            clubId: params.clubId,
            kind: promo.kind,
            amount: promo.amount,
            staffId: params.staffId,
            computerId: params.computerId,
          },
        });

        const wallet = await this.wallets.resolveWallet(params.guestId, params.clubId, tx);
        let balance = wallet.balance;
        let bonusPoints: number;

        if (promo.kind === PromoKind.BALANCE) {
          const updated = await this.wallets.record(tx, {
            walletId: wallet.id,
            clubId: params.clubId,
            amount: promo.amount,
            type: TransactionType.PROMO,
            comment: `Промокод ${promo.code}`,
          });
          balance = updated.balance;
          const guest = await tx.guest.findUniqueOrThrow({
            where: { id: params.guestId },
            select: { bonusPoints: true },
          });
          bonusPoints = guest.bonusPoints;
        } else {
          const guest = await tx.guest.update({
            where: { id: params.guestId },
            data: { bonusPoints: { increment: promo.amount } },
            select: { bonusPoints: true },
          });
          bonusPoints = guest.bonusPoints;
        }

        return { code: promo.code, kind: promo.kind, amount: promo.amount, balance, bonusPoints };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new BadRequestException("Этот промокод вы уже использовали");
      throw error;
    }
  }

  /**
   * Гость играет прямо сейчас — новый баланс сразу на его экран, а не через
   * минуту со следующим списанием: «ввели код, а ничего не поменялось» —
   * верный повод позвать администратора.
   */
  async pushToSeat(guestId: string, clubId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { guestId, clubId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!session) return;
    const snapshot = await this.sessions.sessionSnapshot(session.id);
    if (snapshot) this.bus.emit("session.tick", snapshot);
  }

  private async requirePromo(staff: AuthenticatedStaff, clubId: string, promoId: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id: promoId } });
    if (
      !promo ||
      promo.tenantId !== staff.tenantId ||
      (promo.clubId !== null && promo.clubId !== clubId)
    ) {
      throw new NotFoundException("Промокод не найден");
    }
    return promo;
  }
}

/** Неизвестный код: только такие промахи считаются перебором. */
class PromoNotFound extends Error {
  constructor() {
    super("Такого промокода нет. Проверьте, нет ли опечатки.");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
