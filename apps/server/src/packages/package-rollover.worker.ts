import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { PrismaService } from "../prisma/prisma.service.js";
import { PackageSaleService } from "./package-sale.service.js";

/**
 * Перенос остатка для абонементов, продлённых заранее.
 *
 * Пока прежний абонемент идёт, гость доигрывает его целиком — переносить
 * остаток рано, он ещё тратится. Когда срок вышел, часть того, что осталось,
 * переезжает в новый. Проход раз в минуту: гость не заметит минутной задержки.
 */
@Injectable()
export class PackageRolloverWorker {
  private readonly logger = new Logger(PackageRolloverWorker.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: PackageSaleService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.prisma.guestPackage.findMany({
        where: { renewedById: { not: null }, rolledOverAt: null, expiresAt: { lte: now } },
        select: { id: true },
        take: 200,
      });
      for (const { id } of due) {
        try {
          await this.prisma.$transaction((tx) => this.sales.settle(tx, id, now));
        } catch (error) {
          this.logger.error(`Перенос остатка ${id} не удался: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
