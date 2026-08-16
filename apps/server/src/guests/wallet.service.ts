import { Injectable } from "@nestjs/common";
import type { GuestWallet, Prisma, TransactionType } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";

/** Часть Prisma-клиента, доступная и снаружи, и внутри транзакции. */
type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Кошелёк гостя, действующий в этом клубе.
   *
   * При общем кошельке сети он один и не привязан к клубу; иначе у гостя свой
   * кошелёк в каждом зале. Настройка живёт на сети (docs/billing.md, раздел 9).
   */
  async resolveWallet(guestId: string, clubId: string, db: Db = this.prisma): Promise<GuestWallet> {
    const guest = await db.guest.findUniqueOrThrow({
      where: { id: guestId },
      select: { tenantId: true, tenant: { select: { sharedBalance: true } } },
    });

    const walletClubId = guest.tenant.sharedBalance ? null : clubId;

    const existing = await db.guestWallet.findFirst({
      where: { guestId, clubId: walletClubId },
    });
    if (existing) return existing;

    return db.guestWallet.create({ data: { guestId, clubId: walletClubId } });
  }

  /**
   * Движение по кошельку. Сумма положительная — приход, отрицательная — расход.
   *
   * `clubId` здесь — клуб, которому принадлежит событие: касса при пополнении и
   * зал при расходе. При общем кошельке эти клубы расходятся, и разница между
   * ними образует межклубный взаимозачёт (docs/billing.md, раздел 9.3).
   */
  async record(
    db: Db,
    params: {
      walletId: string;
      clubId: string;
      amount: number;
      type: TransactionType;
      sessionId?: string | null;
      comment?: string | null;
    },
  ): Promise<GuestWallet> {
    const wallet = await db.guestWallet.update({
      where: { id: params.walletId },
      data: { balance: { increment: params.amount } },
    });

    await db.transaction.create({
      data: {
        walletId: params.walletId,
        clubId: params.clubId,
        sessionId: params.sessionId ?? null,
        type: params.type,
        amount: params.amount,
        balanceAfter: wallet.balance,
        comment: params.comment ?? null,
      },
    });

    return wallet;
  }
}
