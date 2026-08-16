import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SegmentEndReason, SessionStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import { SessionsService } from "../sessions/sessions.service.js";

/** Отчёт агента о времени, отыгранном без связи с облаком. */
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
  lastKnownServerTime: string | null;
}

export interface IngestResult {
  applied: number;
  duplicates: number;
  rejected: number;
  /** Сколько минут списано по подтверждению агента. */
  chargedMinutes: number;
  notes: string[];
}

/**
 * Приём отчётов агента о работе без связи с облаком.
 *
 * Правило одно: **сервер начисляет только за подтверждённое время**. Пока
 * машина молчит, срок списания стоит на месте — мы не знаем, играет ли кто-то
 * за ней или её выключили вместе с роутером. Отчёт агента и есть подтверждение:
 * он говорит, сколько минут машина действительно отыграла, и ровно столько
 * списывается (docs/offline.md, раздел 5).
 *
 * Из этого правила следует, что переплаты не возникает и возвращать нечего:
 * система скорее недосчитает за время сбоя, чем возьмёт с гостя лишнее.
 */
@Injectable()
export class OfflineService {
  private readonly logger = new Logger(OfflineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  async ingest(computerId: string, operations: OfflineOperationInput[]): Promise<IngestResult> {
    const computer = await this.prisma.computer.findUnique({ where: { id: computerId } });
    if (!computer) throw new NotFoundException("ПК не найден");

    const result: IngestResult = {
      applied: 0,
      duplicates: 0,
      rejected: 0,
      chargedMinutes: 0,
      notes: [],
    };

    // Порядок восстанавливаем по номеру устройства: пачка могла прийти вперемешку.
    const ordered = [...operations].sort((a, b) => a.sequence - b.sequence);

    for (const operation of ordered) {
      // Ключ идемпотентности: обрыв во время отправки заставит агента прислать
      // ту же пачку снова, и списывать минуты второй раз нельзя.
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

      const outcome = await this.apply(operation);
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
      result.chargedMinutes += operation.minutes;
      if (outcome.note) result.notes.push(outcome.note);
      await this.prisma.offlineOperation.update({
        where: { uuid: operation.uuid },
        data: { appliedAt: new Date() },
      });
    }

    if (result.applied > 0 || result.rejected > 0) {
      this.logger.log(
        `ПК ${computer.name}: принято ${result.applied}, дублей ${result.duplicates}, ` +
          `отклонено ${result.rejected}, списано минут ${result.chargedMinutes}`,
      );
    }

    return result;
  }

  private async apply(
    operation: OfflineOperationInput,
  ): Promise<{ rejected?: string; note?: string }> {
    const session = await this.prisma.session.findUnique({
      where: { id: operation.sessionId },
      include: { computer: { select: { name: true } } },
    });
    if (!session) {
      return { rejected: "Сессия не найдена: возможно, удалена на сервере" };
    }

    if (session.status !== SessionStatus.ACTIVE) {
      // Сессию закрыли на сервере, пока зал работал автономно. Побеждает более
      // раннее закрытие: отыгранное после него не начисляем, но фиксируем
      // в журнале — расхождение попадёт в отчёт.
      return {
        rejected: `${session.computer.name}: сессия уже закрыта на сервере, ${operation.minutes} мин не списаны`,
      };
    }

    await this.sessions.chargeConfirmedMinutes(session.id, operation.minutes);

    if (operation.endedLocally) {
      const stillActive = await this.prisma.session.findUnique({
        where: { id: session.id },
        select: { status: true },
      });
      if (stillActive?.status === SessionStatus.ACTIVE) {
        await this.sessions.finish(session.id, SegmentEndReason.CREDIT_LIMIT);
      }
      return { note: `${session.computer.name}: оплаченное время кончилось без связи` };
    }

    return {};
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
