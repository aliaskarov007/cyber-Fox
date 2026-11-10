import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentMethod, type Product, type ProductSale } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { bonusFor } from "../shifts/shift.rules.js";
import type {
  CreateProductDto,
  SellProductDto,
  UpdateProductDto,
} from "./products.dto.js";

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
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
        imageUrl: dto.imageUrl?.trim() || null,
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

    if (!product.isActive)
      throw new BadRequestException("Товар снят с продажи");
    if (product.stock !== null && product.stock < dto.quantity) {
      throw new BadRequestException(
        `Не хватает на складе: осталось ${product.stock}`,
      );
    }

    // Бар не оплачивается с баланса — только наличные или карта.
    if (
      dto.method !== PaymentMethod.CASH &&
      dto.method !== PaymentMethod.CARD
    ) {
      throw new BadRequestException(
        "Бар оплачивается только наличными или картой",
      );
    }

    const total = product.price * dto.quantity;

    return this.prisma.$transaction(async (tx) => {
      if (product.stock !== null) {
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: dto.quantity } },
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

  private async requireProduct(
    clubId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.clubId !== clubId)
      throw new NotFoundException("Товар не найден");
    return product;
  }
}
