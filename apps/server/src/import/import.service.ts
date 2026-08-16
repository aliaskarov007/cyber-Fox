import { Injectable, Logger } from "@nestjs/common";
import { TariffKind, TransactionType } from "@prisma/client";
import { randomBytes } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { SubscriptionService } from "../billing-platform/subscription.service.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { normalizePhone, parseCsv, parseMoney, pick } from "./csv.js";

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  /** Построчные замечания: что именно не поехало и почему. */
  problems: Array<{ line: number; reason: string }>;
}

/**
 * Перенос данных с чужих систем.
 *
 * Клуб не уйдёт от Senet или SmartShell, если ему придётся вручную вбивать
 * тысячу гостей с балансами. Импорт устроен так, чтобы его можно было запускать
 * повторно: строки сопоставляются по телефону и имени, поэтому неудачную
 * попытку не надо откатывать — достаточно поправить файл и загрузить снова.
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * Гости с балансами. Ожидаемые колонки (любое из названий):
   * имя / клиент / фио, телефон / номер, баланс / счёт, бонусы.
   */
  async guests(staff: AuthenticatedStaff, clubId: string, csv: string): Promise<ImportResult> {
    await this.access.requireClub(staff, clubId);
    const table = parseCsv(csv);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, problems: [] };

    for (const [index, row] of table.rows.entries()) {
      const line = index + 2; // +1 за заголовок, +1 за счёт с единицы
      const name = pick(row, "имя", "клиент", "фио", "name", "fullname");
      const rawPhone = pick(row, "телефон", "номер", "phone", "mobile");
      const phone = normalizePhone(rawPhone);

      if (!phone) {
        result.skipped += 1;
        result.problems.push({
          line,
          reason: rawPhone ? `Не разобрали телефон «${rawPhone}»` : "Нет телефона",
        });
        continue;
      }

      const rawBalance = pick(row, "баланс", "счёт", "счет", "balance", "deposit");
      const balance = rawBalance ? parseMoney(rawBalance) : 0;
      if (rawBalance && balance === null) {
        // Молчаливый ноль обнулил бы гостю деньги — лучше пропустить строку.
        result.skipped += 1;
        result.problems.push({ line, reason: `Не разобрали баланс «${rawBalance}»` });
        continue;
      }

      const bonusRaw = pick(row, "бонусы", "баллы", "bonus", "points");
      const bonus = bonusRaw ? (parseMoney(bonusRaw) ?? 0) : 0;

      try {
        const existing = await this.prisma.guest.findUnique({
          where: { tenantId_phone: { tenantId: staff.tenantId, phone } },
        });

        if (existing) {
          await this.prisma.guest.update({
            where: { id: existing.id },
            data: { fullName: name || existing.fullName, bonusPoints: bonus || existing.bonusPoints },
          });
          result.updated += 1;
          continue;
        }

        const guest = await this.prisma.guest.create({
          data: {
            tenantId: staff.tenantId,
            fullName: name || phone,
            phone,
            bonusPoints: bonus,
          },
        });

        if (balance && balance !== 0) {
          // Перенесённый баланс — это обязательство перед гостем, поэтому он
          // заходит проводкой, а не молчаливой правкой числа в кошельке.
          await this.prisma.$transaction(async (tx) => {
            const wallet = await this.wallets.resolveWallet(guest.id, clubId, tx);
            await this.wallets.record(tx, {
              walletId: wallet.id,
              clubId,
              amount: balance,
              type: TransactionType.ADJUSTMENT,
              comment: "Перенос баланса из прежней системы",
            });
          });
        }

        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.problems.push({ line, reason: (error as Error).message });
      }
    }

    this.logger.log(
      `Импорт гостей в клуб ${clubId}: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`,
    );
    return result;
  }

  /** Машины зала: имя / номер, зона. */
  async computers(staff: AuthenticatedStaff, clubId: string, csv: string): Promise<ImportResult> {
    await this.access.requireClub(staff, clubId);
    const table = parseCsv(csv);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, problems: [] };

    for (const [index, row] of table.rows.entries()) {
      const line = index + 2;
      const name = pick(row, "имя", "название", "номер", "пк", "name", "computer");
      if (!name) {
        result.skipped += 1;
        result.problems.push({ line, reason: "Нет названия машины" });
        continue;
      }

      const zoneName = pick(row, "зона", "зал", "группа", "zone") || "Основной зал";

      try {
        const zone = await this.prisma.zone.upsert({
          where: { clubId_name: { clubId, name: zoneName } },
          update: {},
          create: { clubId, name: zoneName },
        });

        const existing = await this.prisma.computer.findUnique({
          where: { clubId_name: { clubId, name } },
        });

        if (existing) {
          await this.prisma.computer.update({
            where: { id: existing.id },
            data: { zoneId: zone.id },
          });
          result.updated += 1;
          continue;
        }

        // Лимит тарифа проверяем на каждую новую машину: импорт не должен
        // молча превратиться в перерасход подписки.
        await this.subscriptions.assertCanAddComputer(staff.tenantId);

        await this.prisma.computer.create({
          data: {
            clubId,
            zoneId: zone.id,
            name,
            pairingToken: randomBytes(16).toString("hex"),
          },
        });
        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.problems.push({ line, reason: (error as Error).message });
      }
    }

    return result;
  }

  /** Тарифы: название, зона, цена за минуту либо минуты и цена пакета. */
  async tariffs(staff: AuthenticatedStaff, clubId: string, csv: string): Promise<ImportResult> {
    await this.access.requireClub(staff, clubId);
    const table = parseCsv(csv);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, problems: [] };

    for (const [index, row] of table.rows.entries()) {
      const line = index + 2;
      const name = pick(row, "название", "имя", "тариф", "name");
      if (!name) {
        result.skipped += 1;
        result.problems.push({ line, reason: "Нет названия тарифа" });
        continue;
      }

      const zoneName = pick(row, "зона", "зал", "zone") || "Основной зал";
      const perMinuteRaw = pick(row, "цена за минуту", "минута", "priceperminute");
      const packageMinutesRaw = pick(row, "минут", "часы", "minutes");
      const packagePriceRaw = pick(row, "цена", "стоимость", "price");

      try {
        const zone = await this.prisma.zone.upsert({
          where: { clubId_name: { clubId, name: zoneName } },
          update: {},
          create: { clubId, name: zoneName },
        });

        const perMinute = perMinuteRaw ? parseMoney(perMinuteRaw) : null;
        const packageMinutes = packageMinutesRaw ? Number(packageMinutesRaw) : null;
        const packagePrice = packagePriceRaw ? parseMoney(packagePriceRaw) : null;

        const isPackage = packageMinutes !== null && packagePrice !== null && !perMinute;
        if (!isPackage && perMinute === null) {
          result.skipped += 1;
          result.problems.push({ line, reason: "Не поняли цену: нужна минута либо пакет" });
          continue;
        }

        await this.prisma.tariff.upsert({
          where: { clubId_zoneId_name: { clubId, zoneId: zone.id, name } },
          update: isPackage
            ? { kind: TariffKind.PACKAGE, packageMinutes, packagePrice, pricePerMinute: null }
            : { kind: TariffKind.PER_MINUTE, pricePerMinute: perMinute },
          create: {
            clubId,
            zoneId: zone.id,
            name,
            ...(isPackage
              ? { kind: TariffKind.PACKAGE, packageMinutes, packagePrice }
              : { kind: TariffKind.PER_MINUTE, pricePerMinute: perMinute }),
          },
        });

        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.problems.push({ line, reason: (error as Error).message });
      }
    }

    return result;
  }
}
