import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, type Product, type ProductSale, TransactionType } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { bonusFor } from "../shifts/shift.rules.js";
import type { CreateProductDto, SellProductDto, UpdateProductDto } from "./products.dto.js";

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
  ) {}

  async list(staff: AuthenticatedStaff, clubId: string): Promise<Product[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.product.findMany({
      where: { clubId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async create(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateProductDto,
  ): Promise<Product> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.product.create({
      data: {
        clubId,
        name: dto.name.trim(),
        category: dto.category ?? null,
        price: dto.price,
        cost: dto.cost ?? 0,
        stock: dto.stock ?? null,
      },
    });
  }

  async update(
    staff: AuthenticatedStaff,
    clubId: string,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    await this.access.requireClub(staff, clubId);
    await this.requireProduct(clubId, productId);
    return this.prisma.product.update({ where: { id: productId }, data: dto });
  }

  /**
   * Продажа товара.
   *
   * Цена и себестоимость копируются в продажу: изменение прайса завтра не должно
   * переписывать вчерашнюю выручку и маржу в отчёте.
   */
  async sell(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: SellProductDto,
  ): Promise<ProductSale> {
    const club = await this.access.requireClub(staff, clubId);
    const product = await this.requireProduct(clubId, dto.productId);

    if (!product.isActive) throw new BadRequestException("Товар снят с продажи");
    if (product.stock !== null && product.stock < dto.quantity) {
      throw new BadRequestException(`Не хватает на складе: осталось ${product.stock}`);
    }

    if (dto.method === PaymentMethod.BALANCE && !dto.guestId) {
      throw new BadRequestException("Списание с баланса требует гостя");
    }

    const total = product.price * dto.quantity;

    return this.prisma.$transaction(async (tx) => {
      if (product.stock !== null) {
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: dto.quantity } },
        });
      }

      if (dto.method === PaymentMethod.BALANCE) {
        const wallet = await this.wallets.resolveWallet(dto.guestId!, clubId, tx);
        // Товары в долг не продаются: кредит существует, чтобы дать доиграть
        // начатое, а не чтобы кредитовать покупки.
        if (wallet.balance < total) {
          throw new BadRequestException("Недостаточно средств на счету гостя");
        }
        await this.wallets.record(tx, {
          walletId: wallet.id,
          clubId,
          amount: -total,
          type: TransactionType.PRODUCT_SALE,
          comment: `${product.name} ×${dto.quantity}`,
        });
      }

      const shift = await tx.shift.findFirst({
        where: { clubId, closedAt: null },
        orderBy: { openedAt: "desc" },
      });

      const sale = await tx.productSale.create({
        data: {
          clubId,
          productId: product.id,
          guestId: dto.guestId ?? null,
          sessionId: dto.sessionId ?? null,
          shiftId: shift?.id ?? null,
          staffId: staff.id,
          quantity: dto.quantity,
          priceAtSale: product.price,
          costAtSale: product.cost,
          total,
          method: dto.method,
        },
      });

      // Бонусы начисляются от реально потраченного, а не от прейскуранта.
      if (dto.guestId && club.bonusPercent > 0) {
        const bonus = bonusFor(total, club.bonusPercent);
        if (bonus > 0) {
          await tx.guest.update({
            where: { id: dto.guestId },
            data: { bonusPoints: { increment: bonus } },
          });
        }
      }

      return sale;
    });
  }

  private async requireProduct(clubId: string, productId: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.clubId !== clubId) throw new NotFoundException("Товар не найден");
    return product;
  }
}
