import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SegmentEndReason, SessionStatus, TransactionType } from "@prisma/client";

import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SessionsService } from "../sessions/sessions.service.js";

/** Операция, накопленная агентом без связи с облаком. */
export interface OfflineOperationInput {
  /** Сгенерирован на устройстве; повторная доставка ничего не меняет. */
  uuid: string;
  /** Монотонный номер устройства — порядок внутри пачки. */
  sequence: number;
  kind: string;
  sessionId: string;
  /** Сколько минут машина реально играла без связи. */
  minutes: number;
  /** Оплаченное время кончилось локально и экран заблокирован. */
  endedLocally?: boolean;
  deviceTime: string;
  /** Последний тик от сервера — граница, после которой начался обрыв. */
  lastKnownServerTime: string | null;
}

export interface IngestResult {
  applied: number;
  duplicates: number;
  rejected: number;
  /** Сколько минут вернули гостю как начисленные сверх реально отыгранных. */
  refundedMinutes: number;
  notes: string[];
}

/**
 * Приём отчётов агента о работе без связи с облаком.
 *
 * Разделение ответственности здесь принципиальное. **Деньги считает сервер**:
 * срок списания хранится в базе, и после перезапуска движок сам досчитывает
 * пропущенные минуты. Агент об этом не знает и повторно ничего не начисляет —
 * иначе каждая минута обрыва списывалась бы дважды.
 *
 * **Агент владеет фактом игры**: только он знает, что машину выключили или что
 * оплаченное время кончилось раньше, чем сервер вернулся. Его отчёт нужен,
 * чтобы вернуть гостю деньги за время, которого не было
 * (docs/offline.md, раздел 5).
 */
@Injectable()
export class OfflineService {
  private readonly logger = new Logger(OfflineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly wallets: WalletService,
  ) {}

  async ingest(computerId: string, operations: OfflineOperationInput[]): Promise<IngestResult> {
    const computer = await this.prisma.computer.findUnique({ where: { id: computerId } });
    if (!computer) throw new NotFoundException("ПК не найден");

    const result: IngestResult = {
      applied: 0,
      duplicates: 0,
      rejected: 0,
      refundedMinutes: 0,
      notes: [],
    };

    // Порядок восстанавливаем по номеру устройства: пачка могла прийти вперемешку.
    const ordered = [...operations].sort((a, b) => a.sequence - b.sequence);

    for (const operation of ordered) {
      const existing = await this.prisma.offlineOperation.findUnique({
        where: { uuid: operation.uuid },
      });
      if (existing) {
        result.duplicates += 1;
        continue;
      }

      await this.prisma.offlineOperation.create({
        data: {
          uuid: operation.uuid,
          computerId,
          sessionId: operation.sessionId,
          sequence: operation.sequence,
          kind: operation.kind,
          minutes: operation.minutes,
          deviceTime: new Date(operation.deviceTime),
          lastKnownServerTime: operation.lastKnownServerTime
            ? new Date(operation.lastKnownServerTime)
            : null,
        },
      });

      const outcome = await this.reconcile(operation);
      if (outcome.rejected) {
        result.rejected += 1;
        result.notes.push(outcome.rejected);
        await this.prisma.offlineOperation.update({
          where: { uuid: operation.uuid },
          data: { rejectedReason: outcome.rejected },
        });
        continue;
      }

      result.applied += 1;
      result.refundedMinutes += outcome.refundedMinutes;
      if (outcome.note) result.notes.push(outcome.note);
      await this.prisma.offlineOperation.update({
        where: { uuid: operation.uuid },
        data: { appliedAt: new Date() },
      });
    }

    if (result.applied > 0 || result.rejected > 0) {
      this.logger.log(
        `ПК ${computer.name}: сверено ${result.applied}, дублей ${result.duplicates}, ` +
          `отклонено ${result.rejected}, возвращено минут ${result.refundedMinutes}`,
      );
    }

    return result;
  }

  /**
   * Сверяет отчёт агента с тем, что успел списать сервер за время обрыва.
   *
   * Границей служит последний тик, полученный агентом: всё, что сервер начислил
   * после него, относится к периоду без связи.
   */
  private async reconcile(
    operation: OfflineOperationInput,
  ): Promise<{ rejected?: string; note?: string; refundedMinutes: number }> {
    const session = await this.prisma.session.findUnique({
      where: { id: operation.sessionId },
      include: { computer: { select: { name: true } } },
    });
    if (!session) {
      return { rejected: "Сессия не найдена: возможно, удалена на сервере", refundedMinutes: 0 };
    }

    const reported = operation.lastKnownServerTime
      ? new Date(operation.lastKnownServerTime)
      : null;
    if (!reported) {
      return {
        rejected: "Агент не знает времени последней синхронизации: сверить период нечем",
        refundedMinutes: 0,
      };
    }

    /*
     * Период сверки начинается позже отчётной границы, если этот отрезок уже
     * сверяли. Иначе повторный отчёт за то же время — а он неизбежен при обрыве
     * до подтверждения — вернул бы гостю деньги второй раз.
     */
    const boundary =
      session.offlineReconciledAt && session.offlineReconciledAt > reported
        ? session.offlineReconciledAt
        : reported;

    // Минуты, списанные сервером за ещё не сверенный период без связи.
    const chargesAfter = await this.prisma.transaction.findMany({
      where: {
        sessionId: session.id,
        type: TransactionType.SESSION_CHARGE,
        createdAt: { gt: boundary },
      },
      orderBy: { createdAt: "asc" },
    });

    const excess = chargesAfter.slice(operation.minutes);
    let refundedMinutes = 0;

    if (excess.length > 0) {
      // Сервер начислил больше, чем машина реально играла: ПК выключили или
      // оплаченное время кончилось раньше. Разницу возвращаем гостю.
      const amount = excess.reduce((sum, t) => sum - t.amount, 0);
      refundedMinutes = excess.length;

      if (session.guestId && amount > 0) {
        await this.prisma.$transaction(async (tx) => {
          const wallet = await this.wallets.resolveWallet(session.guestId!, session.clubId, tx);
          await this.wallets.record(tx, {
            walletId: wallet.id,
            clubId: session.clubId,
            amount,
            type: TransactionType.REFUND,
            sessionId: session.id,
            comment: `Возврат за ${excess.length} мин: машина не играла во время обрыва связи`,
          });
          await tx.session.update({
            where: { id: session.id },
            data: { totalCharged: { decrement: amount } },
          });
        });
      } else if (session.prepaidRemaining !== null && amount > 0) {
        // Анонимная посадка: возвращаем в остаток предоплаты.
        await this.prisma.session.update({
          where: { id: session.id },
          data: {
            prepaidRemaining: { increment: amount },
            totalCharged: { decrement: amount },
          },
        });
      }
    }

    // Отмечаем период как сверенный — до текущего момента.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { offlineReconciledAt: new Date() },
    });

    // Оплаченное время кончилось локально — сессию пора закрыть, если сервер
    // этого ещё не сделал.
    if (operation.endedLocally && session.status === SessionStatus.ACTIVE) {
      await this.sessions.finish(session.id, SegmentEndReason.CREDIT_LIMIT);
      return {
        note: `${session.computer.name}: сессия закрыта по отчёту агента`,
        refundedMinutes,
      };
    }

    return {
      note:
        refundedMinutes > 0
          ? `${session.computer.name}: возвращено ${refundedMinutes} мин, начисленных сверх отыгранного`
          : undefined,
      refundedMinutes,
    };
  }

  /** Расхождения после автономной работы: отдельный отчёт для разбора. */
  async discrepancies(clubId: string, since: Date) {
    return this.prisma.offlineOperation.findMany({
      where: {
        computer: { clubId },
        createdAt: { gte: since },
        OR: [{ rejectedReason: { not: null } }, { minutes: { gt: 0 } }],
      },
      include: { computer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
