import { Injectable } from "@nestjs/common";
import { type ConsentSource, type Prisma, TransactionType } from "@prisma/client";

import { normalizePhone } from "../common/phone.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { consentText, formatTenge } from "./consent.rules.js";
import { WalletService } from "./wallet.service.js";

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Согласие на приглашения и подарок за него.
 *
 * Подарок выдаётся один раз на гостя и только при подтверждённом номере:
 * иначе его собирали бы пачкой аккаунтов на выдуманные номера.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
  ) {}

  /**
   * Записать согласие. Возвращает начисленный подарок в тиын (0 — не начислен).
   *
   * Внутри запроса кассы передаётся `db` — клиент этого запроса: своя
   * транзакция здесь не увидела бы гостя, только что заведённого в нём, и
   * упёрлась бы в его же блокировку строки.
   */
  async give(guestId: string, clubId: string, source: ConsentSource, db?: Db): Promise<number> {
    const run = async (client: Db): Promise<number> => {
      const club = await client.club.findUniqueOrThrow({ where: { id: clubId } });
      await client.guest.update({
        where: { id: guestId },
        data: {
          marketingConsentAt: new Date(),
          marketingConsentSource: source,
          marketingConsentText: consentText(club.consentBonus),
          marketingOptOutAt: null,
        },
      });
      return this.grantBonus(client, guestId, clubId);
    };
    return db ? run(db) : this.prisma.$transaction((tx) => run(tx));
  }

  /** Отозвать согласие со стойки — по просьбе гостя. */
  async withdraw(guestId: string): Promise<void> {
    await this.prisma.guest.update({
      where: { id: guestId },
      data: { marketingOptOutAt: new Date() },
    });
  }

  /** «СТОП» из WhatsApp: отписываем все аккаунты с этим номером. */
  async optOutByPhone(rawPhone: string): Promise<number> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return 0;
    const result = await this.prisma.guest.updateMany({
      where: { phone, marketingConsentAt: { not: null }, marketingOptOutAt: null },
      data: { marketingOptOutAt: new Date() },
    });
    return result.count;
  }

  /**
   * Подарок, если всё сошлось: согласие есть, номер подтверждён, подарка ещё
   * не было. Вызывается и после согласия, и после подтверждения номера — что
   * случится позже, то и выдаст.
   */
  async grantBonus(db: Db, guestId: string, clubId: string): Promise<number> {
    const club = await db.club.findUniqueOrThrow({ where: { id: clubId } });
    if (club.consentBonus <= 0) return 0;

    // Отметка ставится условием на саму строку: два одновременных вызова не
    // выдадут подарок дважды.
    const claimed = await db.guest.updateMany({
      where: {
        id: guestId,
        phoneVerifiedAt: { not: null },
        marketingConsentAt: { not: null },
        consentBonusGrantedAt: null,
      },
      data: { consentBonusGrantedAt: new Date() },
    });
    if (claimed.count === 0) return 0;

    const wallet = await this.wallets.resolveWallet(guestId, clubId, db);
    await this.wallets.record(db, {
      walletId: wallet.id,
      clubId,
      amount: club.consentBonus,
      type: TransactionType.BONUS_ACCRUAL,
      comment: `Подарок за подписку на приглашения, ${formatTenge(club.consentBonus)}`,
    });
    return club.consentBonus;
  }
}
