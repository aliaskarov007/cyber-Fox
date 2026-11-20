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
  ReceiveStockDto,
  SellCartDto,
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
   * Оприходование товара. Себестоимость вводится на каждой приёмке, а
   * себестоимость товара становится средневзвешенной по остатку и приходу —
   * так маржа считается честно, даже если закупочная цена менялась.
   *
   * Для товара без учёта остатков усреднять не по чему: берём себестоимость
   * последней приёмки.
   */
  async receiveStock(
    staff: AuthenticatedStaff,
    clubId: string,
    productId: string,
    dto: ReceiveStockDto,
  ): Promise<Product> {
    await this.access.requireClub(staff, clubId);
    const product = await this.requireProduct(clubId, productId);

    let newCost: number;
    let newStock: number | null;
    if (product.stock === null) {
      newCost = dto.unitCost;
      newStock = null;
    } else {
      const newQty = product.stock + dto.quantity;
      newCost =
        newQty > 0
          ? Math.round(
              (product.stock * product.cost + dto.quantity * dto.unitCost) /
                newQty,
            )
          : dto.unitCost;
      newStock = newQty;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.goodsReceipt.create({
        data: {
          clubId,
          productId: product.id,
          staffId: staff.id,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
        },
      });
      return tx.product.update({
        where: { id: product.id },
        data: { stock: newStock, cost: newCost },
      });
    });
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

  /**
   * Чек из нескольких товаров: кассир набирает корзину и пробивает её одним
   * способом оплаты. Все позиции проходят в одной транзакции — либо весь чек,
   * либо ничего, чтобы остаток склада и выручка смены не разошлись при сбое.
   * Привязки к гостю и бонусов здесь нет: касса бара продаёт анонимно.
   */
  async sellCart(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: SellCartDto,
  ): Promise<{ total: number; items: number }> {
    await this.access.requireClub(staff, clubId);

    if (
      dto.method !== PaymentMethod.CASH &&
      dto.method !== PaymentMethod.CARD
    ) {
      throw new BadRequestException(
        "Бар оплачивается только наличными или картой",
      );
    }

    // Одна позиция на товар: если кассир добавил один товар дважды, складываем
    // количества, иначе две строки спорили бы за один остаток склада.
    const merged = new Map<string, number>();
    for (const item of dto.items) {
      merged.set(
        item.productId,
        (merged.get(item.productId) ?? 0) + item.quantity,
      );
    }

    const products = await Promise.all(
      [...merged.keys()].map((id) => this.requireProduct(clubId, id)),
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const [productId, quantity] of merged) {
      const product = byId.get(productId)!;
      if (!product.isActive) {
        throw new BadRequestException(`Товар «${product.name}» снят с продажи`);
      }
      if (product.stock !== null && product.stock < quantity) {
        throw new BadRequestException(
          `Не хватает «${product.name}»: осталось ${product.stock}`,
        );
      }
    }

    const total = [...merged].reduce(
      (sum, [productId, quantity]) =>
        sum + byId.get(productId)!.price * quantity,
      0,
    );

    await this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({
        where: { clubId, closedAt: null },
        orderBy: { openedAt: "desc" },
      });

      for (const [productId, quantity] of merged) {
        const product = byId.get(productId)!;
        if (product.stock !== null) {
          await tx.product.update({
            where: { id: product.id },
            data: { stock: { decrement: quantity } },
          });
        }
        await tx.productSale.create({
          data: {
            clubId,
            productId: product.id,
            sessionId: null,
            shiftId: shift?.id ?? null,
            staffId: staff.id,
            quantity,
            priceAtSale: product.price,
            costAtSale: product.cost,
            total: product.price * quantity,
            method: dto.method,
          },
        });
      }
    });

    return { total, items: merged.size };
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
