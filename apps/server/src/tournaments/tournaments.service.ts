import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  type Prisma,
  TournamentStatus,
  TournamentTeamStatus,
  TransactionType,
} from "@prisma/client";
import { randomInt } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  canJoinTeam,
  gatherDeadline,
  makeTeamCode,
  prizeBreakdown,
  prizePool,
  slotsLeft,
  teamState,
} from "./tournament.rules.js";

type Db = Prisma.TransactionClient | PrismaService;

/** Команды, которые держат место: собранные и ещё собирающиеся. */
const ACTIVE_TEAMS = [TournamentTeamStatus.GATHERING, TournamentTeamStatus.READY];

export interface JoinOutcome {
  ok: boolean;
  /** Что сказать гостю в WhatsApp. */
  message: string;
  /** Нужно пополнить счёт: столько не хватает, в тиын. */
  shortBy?: number;
  /** Код заведённой команды — капитану его нужно переслать напарникам. */
  teamCode?: string;
  /** Сколько человек уже в составе и сколько нужно. */
  filled?: number;
  teamSize?: number;
}

/**
 * Запись на турнир и сбор команд.
 *
 * Деньги идут через кошелёк гостя, а не мимо: взнос, возврат и приз попадают
 * в отчёт смены и в историю на карточке, поэтому отдельной «турнирной кассы»
 * не существует.
 */
@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
  ) {}

  /**
   * Сделать ивент турниром.
   *
   * Отдельным шагом после создания ивента, а не полем в нём: афиша и турнир
   * заводятся одним и тем же экраном, но турнирных настроек семь, и мешать их
   * с обычным ивентом значит показывать их тем, кому они не нужны.
   */
  async attach(
    staff: AuthenticatedStaff,
    clubId: string,
    eventId: string,
    dto: {
      teamSize: number;
      slots: number;
      entryFee: number;
      clubFeePercent?: number;
      clubBonus?: number;
      prizeSplit?: number[];
      gatherWindowMinutes?: number;
    },
  ) {
    await this.access.requireClub(staff, clubId);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { tournament: true },
    });
    if (!event || event.clubId !== clubId) throw new NotFoundException("Ивент не найден");
    if (event.tournament) throw new BadRequestException("Турнир уже заведён");
    if (event.sentAt) {
      // Взнос и число мест уходят в тексте приглашения: после рассылки их
      // изменение означало бы, что часть гостей согласилась на другие условия.
      throw new BadRequestException("Приглашения уже разосланы — турнир не завести");
    }

    return this.prisma.tournament.create({
      data: {
        eventId,
        teamSize: dto.teamSize,
        slots: dto.slots,
        entryFee: dto.entryFee,
        clubFeePercent: dto.clubFeePercent ?? 0,
        clubBonus: dto.clubBonus ?? 0,
        ...(dto.prizeSplit ? { prizeSplit: dto.prizeSplit } : {}),
        ...(dto.gatherWindowMinutes ? { gatherWindowMinutes: dto.gatherWindowMinutes } : {}),
      },
    });
  }

  // --- Деньги ---

  /**
   * Списание взноса.
   *
   * Запись без оплаты не создаётся вовсе: иначе место держал бы тот, кто ещё
   * ничего не внёс, и у каждой записи появилось бы половинчатое состояние,
   * которое пришлось бы учитывать во всех подсчётах мест и фонда.
   */
  private async charge(
    tx: Prisma.TransactionClient,
    params: { guestId: string; clubId: string; amount: number; comment: string },
  ): Promise<{ ok: boolean; shortBy: number }> {
    const wallet = await this.wallets.resolveWallet(params.guestId, params.clubId, tx);
    if (wallet.balance < params.amount) {
      return { ok: false, shortBy: params.amount - wallet.balance };
    }

    await this.wallets.record(tx, {
      walletId: wallet.id,
      clubId: params.clubId,
      amount: -params.amount,
      type: TransactionType.TOURNAMENT_ENTRY,
      comment: params.comment,
    });
    return { ok: true, shortBy: 0 };
  }

  /**
   * Возврат взноса — **только на баланс аккаунта**, никогда наружу.
   *
   * Обратного платежа в Kaspi здесь нет и не должно появиться: деньги гость
   * уже положил на счёт в клубе, и турнир их оттуда взял. Вернуть их на карту
   * значило бы вывести из клуба средства, которые туда внесли на игру, —
   * причём по событию, которое клуб не планировал (несобравшаяся команда).
   * Гость тратит возвращённое на следующий визит.
   *
   * Идемпотентен: дважды вернуть одну запись нельзя.
   */
  private async refund(
    tx: Prisma.TransactionClient,
    entry: { id: string; guestId: string; paidAmount: number; refundedAt: Date | null },
    clubId: string,
    comment: string,
  ): Promise<void> {
    if (entry.refundedAt || entry.paidAmount <= 0) return;

    const wallet = await this.wallets.resolveWallet(entry.guestId, clubId, tx);
    await this.wallets.record(tx, {
      walletId: wallet.id,
      clubId,
      amount: entry.paidAmount,
      type: TransactionType.TOURNAMENT_REFUND,
      comment,
    });
    await tx.tournamentEntry.update({
      where: { id: entry.id },
      data: { refundedAt: new Date() },
    });
  }

  // --- Запись ---

  /** Турнир ближайшего неотменённого ивента, на который гость получил приглашение. */
  async pendingFor(guestId: string, tenantId: string) {
    return this.prisma.tournament.findFirst({
      where: {
        status: TournamentStatus.REGISTRATION,
        event: {
          tenantId,
          canceledAt: null,
          startsAt: { gt: new Date() },
          invites: { some: { guestId } },
        },
      },
      orderBy: { event: { startsAt: "asc" } },
      include: { event: true },
    });
  }

  async byCode(code: string) {
    return this.prisma.tournamentTeam.findUnique({
      where: { code },
      include: { tournament: { include: { event: true } } },
    });
  }

  /**
   * Гость согласился участвовать: заводим его команду и делаем капитаном.
   *
   * На турнире одиночек это та же команда, просто из одного человека — она
   * сразу становится укомплектованной.
   */
  async joinAsCaptain(tournamentId: string, guestId: string): Promise<JoinOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: { event: true },
      });

      if (tournament.status !== TournamentStatus.REGISTRATION) {
        return { ok: false, message: "Запись на турнир закрыта." };
      }

      const existing = await tx.tournamentEntry.findUnique({
        where: { tournamentId_guestId: { tournamentId, guestId } },
      });
      if (existing) return { ok: false, message: "Вы уже записаны на этот турнир." };

      const activeTeams = await tx.tournamentTeam.count({
        where: { tournamentId, status: { in: ACTIVE_TEAMS } },
      });
      if (slotsLeft({ slots: tournament.slots, activeTeams }) === 0) {
        return { ok: false, message: "Все места разобраны." };
      }

      const paid = await this.charge(tx, {
        guestId,
        clubId: tournament.event.clubId,
        amount: tournament.entryFee,
        comment: `Взнос: ${tournament.event.title}`,
      });
      if (!paid.ok) {
        return {
          ok: false,
          shortBy: paid.shortBy,
          message: "Не хватает денег на счёте для взноса.",
        };
      }

      const now = new Date();
      const team = await tx.tournamentTeam.create({
        data: {
          tournamentId,
          code: await this.freeTeamCode(tx),
          captainGuestId: guestId,
          gatherDeadline: gatherDeadline(now, tournament.gatherWindowMinutes),
          status:
            teamState({ teamSize: tournament.teamSize, paidMembers: 1 }) === "READY"
              ? TournamentTeamStatus.READY
              : TournamentTeamStatus.GATHERING,
          readyAt: tournament.teamSize === 1 ? now : null,
        },
      });

      await tx.tournamentEntry.create({
        data: {
          tournamentId,
          guestId,
          teamId: team.id,
          paidAmount: tournament.entryFee,
          paidAt: now,
        },
      });

      return {
        ok: true,
        message:
          tournament.teamSize === 1
            ? "Записали вас на турнир."
            : `Вы капитан. Код команды: ${team.code}`,
        teamCode: team.code,
        filled: 1,
        teamSize: tournament.teamSize,
      };
    });
  }

  /** Напарник прислал код команды. */
  async joinByCode(code: string, guestId: string, teamName: string | null): Promise<JoinOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.tournamentTeam.findUnique({
        where: { code },
        include: { tournament: { include: { event: true } } },
      });
      if (!team) return { ok: false, message: "Такой команды нет." };

      const { tournament } = team;
      const [members, existing] = await Promise.all([
        tx.tournamentEntry.count({ where: { teamId: team.id } }),
        tx.tournamentEntry.findUnique({
          where: { tournamentId_guestId: { tournamentId: tournament.id, guestId } },
        }),
      ]);

      /*
       * Прислал свой же код. Для капитана это способ назвать команду: имя
       * берём только у него, иначе названием стала бы случайная приписка
       * напарника вроде «я в деле».
       */
      if (existing?.teamId === team.id) {
        const naming = guestId === team.captainGuestId && !team.name && teamName;
        if (naming) {
          await tx.tournamentTeam.update({ where: { id: team.id }, data: { name: teamName } });
        }
        return {
          ok: true,
          message: naming
            ? `Команда теперь «${teamName}». Собрано ${members} из ${tournament.teamSize}.`
            : `Вы уже в этой команде. Собрано ${members} из ${tournament.teamSize}.`,
        };
      }

      const verdict = canJoinTeam({
        tournamentStatus: tournament.status,
        teamStatus: team.status,
        teamSize: tournament.teamSize,
        membersInTeam: members,
        alreadyEntered: existing !== null,
      });
      if (!verdict.ok) return { ok: false, message: `${verdict.reason}.` };

      const paid = await this.charge(tx, {
        guestId,
        clubId: tournament.event.clubId,
        amount: tournament.entryFee,
        comment: `Взнос: ${tournament.event.title}`,
      });
      if (!paid.ok) {
        return {
          ok: false,
          shortBy: paid.shortBy,
          message: "Не хватает денег на счёте для взноса.",
        };
      }

      const now = new Date();
      await tx.tournamentEntry.create({
        data: {
          tournamentId: tournament.id,
          guestId,
          teamId: team.id,
          paidAmount: tournament.entryFee,
          paidAt: now,
        },
      });

      const filled = members + 1;
      const ready = teamState({ teamSize: tournament.teamSize, paidMembers: filled }) === "READY";
      if (ready) {
        await tx.tournamentTeam.update({
          where: { id: team.id },
          data: { status: TournamentTeamStatus.READY, readyAt: now },
        });
      }

      return {
        ok: true,
        message: ready
          ? `Команда в сборе: ${filled} из ${tournament.teamSize}. Место закреплено.`
          : `Вы в команде. Собрано ${filled} из ${tournament.teamSize}.`,
      };
    });
  }

  /**
   * Гость записался один на командный турнир.
   *
   * Взнос списывается сразу, по общему правилу: иначе администратор ставил бы
   * его в команду и только там узнавал, что денег нет.
   */
  async joinAsFreeAgent(tournamentId: string, guestId: string): Promise<JoinOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: { event: true },
      });

      if (tournament.teamSize === 1) {
        return { ok: false, message: "Это турнир одиночек — команда не нужна." };
      }
      if (tournament.status !== TournamentStatus.REGISTRATION) {
        return { ok: false, message: "Запись на турнир закрыта." };
      }

      const existing = await tx.tournamentEntry.findUnique({
        where: { tournamentId_guestId: { tournamentId, guestId } },
      });
      if (existing) return { ok: false, message: "Вы уже записаны на этот турнир." };

      const paid = await this.charge(tx, {
        guestId,
        clubId: tournament.event.clubId,
        amount: tournament.entryFee,
        comment: `Взнос: ${tournament.event.title}`,
      });
      if (!paid.ok) {
        return { ok: false, shortBy: paid.shortBy, message: "Не хватает денег на счёте для взноса." };
      }

      await tx.tournamentEntry.create({
        data: { tournamentId, guestId, teamId: null, paidAmount: tournament.entryFee, paidAt: new Date() },
      });

      return {
        ok: true,
        message: "Записали вас в список свободных игроков — подберём команду до начала.",
      };
    });
  }

  /** Код, которого ещё нет. Повтор маловероятен, но проверить дешевле, чем разбирать. */
  private async freeTeamCode(tx: Db): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = makeTeamCode((max) => randomInt(max));
      const taken = await tx.tournamentTeam.findUnique({ where: { code } });
      if (!taken) return code;
    }
    throw new BadRequestException("Не удалось выдать код команды");
  }

  // --- Администратор ---

  /** Поставить свободного игрока в неполную команду. */
  async assignFreeAgent(
    staff: AuthenticatedStaff,
    clubId: string,
    entryId: string,
    teamId: string,
  ): Promise<void> {
    await this.access.requireClub(staff, clubId);

    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.tournamentEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { tournament: true },
      });
      if (entry.teamId) throw new BadRequestException("Игрок уже в команде");

      const team = await tx.tournamentTeam.findUniqueOrThrow({ where: { id: teamId } });
      if (team.tournamentId !== entry.tournamentId) {
        throw new BadRequestException("Команда из другого турнира");
      }
      if (team.status === TournamentTeamStatus.DISBANDED) {
        throw new BadRequestException("Команда расформирована");
      }

      const members = await tx.tournamentEntry.count({ where: { teamId } });
      if (members >= entry.tournament.teamSize) {
        throw new BadRequestException("В команде нет места");
      }

      await tx.tournamentEntry.update({ where: { id: entryId }, data: { teamId } });

      const filled = members + 1;
      if (teamState({ teamSize: entry.tournament.teamSize, paidMembers: filled }) === "READY") {
        await tx.tournamentTeam.update({
          where: { id: teamId },
          data: { status: TournamentTeamStatus.READY, readyAt: new Date() },
        });
      }
    });
  }

  /**
   * Закрытие записи: состав зафиксирован.
   *
   * Всё, что не собралось, распускается здесь же — держать место дальше
   * незачем, а деньги должны вернуться до начала, а не после.
   */
  async closeRegistration(
    staff: AuthenticatedStaff,
    clubId: string,
    tournamentId: string,
  ): Promise<{ disbanded: number; refunded: number }> {
    await this.access.requireClub(staff, clubId);

    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: { event: true },
      });

      const incomplete = await tx.tournamentTeam.findMany({
        where: { tournamentId, status: TournamentTeamStatus.GATHERING },
        include: { entries: true },
      });

      let refunded = 0;
      for (const team of incomplete) {
        for (const entry of team.entries) {
          await this.refund(tx, entry, tournament.event.clubId, "Команда не собралась");
          refunded += 1;
        }
      }
      if (incomplete.length > 0) {
        await tx.tournamentTeam.updateMany({
          where: { id: { in: incomplete.map((t) => t.id) } },
          data: { status: TournamentTeamStatus.DISBANDED, disbandedAt: new Date() },
        });
      }

      // Свободные игроки, которым не нашлось состава.
      const orphans = await tx.tournamentEntry.findMany({
        where: { tournamentId, teamId: null, refundedAt: null },
      });
      for (const entry of orphans) {
        await this.refund(tx, entry, tournament.event.clubId, "Команда не нашлась");
        refunded += 1;
      }

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: TournamentStatus.CLOSED },
      });

      return { disbanded: incomplete.length, refunded };
    });
  }

  /** Отмена турнира: возврат всем, кто внёс. */
  async cancel(staff: AuthenticatedStaff, clubId: string, tournamentId: string): Promise<{ refunded: number }> {
    await this.access.requireClub(staff, clubId);

    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: { event: true },
      });

      const entries = await tx.tournamentEntry.findMany({
        where: { tournamentId, refundedAt: null },
      });
      for (const entry of entries) {
        await this.refund(tx, entry, tournament.event.clubId, "Турнир отменён");
      }

      await tx.tournamentTeam.updateMany({
        where: { tournamentId, status: { in: ACTIVE_TEAMS } },
        data: { status: TournamentTeamStatus.DISBANDED, disbandedAt: new Date() },
      });
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: TournamentStatus.CANCELED },
      });
      await tx.event.update({
        where: { id: tournament.eventId },
        data: { canceledAt: new Date() },
      });

      return { refunded: entries.length };
    });
  }

  /** Выплата призов: администратор называет команды-победители по порядку мест. */
  async payPrizes(
    staff: AuthenticatedStaff,
    clubId: string,
    tournamentId: string,
    teamIds: string[],
  ): Promise<{ paid: number; total: number }> {
    await this.access.requireClub(staff, clubId);

    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: { event: true },
      });

      const alreadyPaid = await tx.tournamentEntry.count({
        where: { tournamentId, prizeAmount: { not: null } },
      });
      if (alreadyPaid > 0) throw new BadRequestException("Призы уже выплачены");

      const pool = await this.poolOf(tx, tournament);
      const shares = prizeBreakdown(pool, tournament.prizeSplit);

      let paid = 0;
      let total = 0;
      for (const [index, teamId] of teamIds.entries()) {
        const share = shares[index];
        if (share === undefined || share <= 0) continue;

        const winners = await tx.tournamentEntry.findMany({ where: { teamId } });
        if (winners.length === 0) continue;

        // Приз делится поровну между участниками команды; остаток — капитану.
        const each = Math.floor(share / winners.length);
        const remainder = share - each * winners.length;

        for (const [position, entry] of winners.entries()) {
          const amount = each + (position === 0 ? remainder : 0);
          if (amount <= 0) continue;

          const wallet = await this.wallets.resolveWallet(entry.guestId, tournament.event.clubId, tx);
          await this.wallets.record(tx, {
            walletId: wallet.id,
            clubId: tournament.event.clubId,
            amount,
            type: TransactionType.TOURNAMENT_PRIZE,
            comment: `Приз за ${index + 1} место: ${tournament.event.title}`,
          });
          await tx.tournamentEntry.update({
            where: { id: entry.id },
            data: { prizePlace: index + 1, prizeAmount: amount },
          });
          paid += 1;
          total += amount;
        }
      }

      return { paid, total };
    });
  }

  private async poolOf(
    db: Db,
    tournament: { id: string; entryFee: number; clubFeePercent: number; clubBonus: number },
  ): Promise<number> {
    const paidEntries = await db.tournamentEntry.count({
      where: { tournamentId: tournament.id, refundedAt: null, paidAmount: { gt: 0 } },
    });
    return prizePool({
      paidEntries,
      entryFee: tournament.entryFee,
      clubFeePercent: tournament.clubFeePercent,
      clubBonus: tournament.clubBonus,
    });
  }

  /** Турнир глазами администратора: состав, свободные игроки, фонд. */
  async summary(staff: AuthenticatedStaff, clubId: string, tournamentId: string) {
    await this.access.requireClub(staff, clubId);

    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: {
        event: true,
        teams: {
          where: { status: { in: ACTIVE_TEAMS } },
          orderBy: { createdAt: "asc" },
          include: {
            entries: { include: { guest: { select: { id: true, fullName: true, phone: true } } } },
          },
        },
      },
    });

    const freeAgents = await this.prisma.tournamentEntry.findMany({
      where: { tournamentId, teamId: null, refundedAt: null },
      include: { guest: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { createdAt: "asc" },
    });

    const activeTeams = tournament.teams.length;
    const pool = await this.poolOf(this.prisma, tournament);

    return {
      tournament: {
        id: tournament.id,
        eventId: tournament.eventId,
        title: tournament.event.title,
        startsAt: tournament.event.startsAt,
        status: tournament.status,
        teamSize: tournament.teamSize,
        slots: tournament.slots,
        entryFee: tournament.entryFee,
        clubFeePercent: tournament.clubFeePercent,
        clubBonus: tournament.clubBonus,
        prizeSplit: tournament.prizeSplit,
        gatherWindowMinutes: tournament.gatherWindowMinutes,
      },
      slotsLeft: slotsLeft({ slots: tournament.slots, activeTeams }),
      prizePool: pool,
      prizeBreakdown: prizeBreakdown(pool, tournament.prizeSplit),
      teams: tournament.teams.map((team) => ({
        id: team.id,
        code: team.code,
        name: team.name,
        status: team.status,
        gatherDeadline: team.gatherDeadline,
        captainGuestId: team.captainGuestId,
        members: team.entries.map((entry) => ({
          entryId: entry.id,
          guestId: entry.guest.id,
          fullName: entry.guest.fullName,
          phone: entry.guest.phone,
          isCaptain: entry.guestId === team.captainGuestId,
        })),
      })),
      freeAgents: freeAgents.map((entry) => ({
        entryId: entry.id,
        guestId: entry.guest.id,
        fullName: entry.guest.fullName,
        phone: entry.guest.phone,
      })),
    };
  }

  /**
   * Команды, не собравшиеся в срок, распускаются сами.
   *
   * Без этого место держала бы команда, которую капитан завёл и бросил, а
   * деньги напарников висели бы списанными до самого турнира.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireTeams(): Promise<void> {
    const overdue = await this.prisma.tournamentTeam.findMany({
      where: {
        status: TournamentTeamStatus.GATHERING,
        gatherDeadline: { lt: new Date() },
        tournament: { status: TournamentStatus.REGISTRATION },
      },
      include: { entries: true, tournament: { include: { event: true } } },
      take: 50,
    });
    if (overdue.length === 0) return;

    for (const team of overdue) {
      await this.prisma.$transaction(async (tx) => {
        for (const entry of team.entries) {
          await this.refund(tx, entry, team.tournament.event.clubId, "Команда не собралась в срок");
        }
        await tx.tournamentTeam.update({
          where: { id: team.id },
          data: { status: TournamentTeamStatus.DISBANDED, disbandedAt: new Date() },
        });
      });
    }

    this.logger.log(`Расформировано несобравшихся команд: ${overdue.length}`);
  }
}
