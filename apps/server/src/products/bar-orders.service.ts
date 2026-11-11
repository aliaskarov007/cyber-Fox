import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  BarOrderStatus,
  type Prisma,
  PaymentIntentStatus,
  SessionStatus,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { KaspiService, type TopUpMethod } from "../payments/kaspi.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import {
  type OrderItemSnapshot,
  normalizeOrderLines,
  orderTotal,
} from "./bar-order.rules.js";

export interface BarMenu {
  /** Клуб разрешил заказ с игровых ПК. Выключено — кнопки «Бар» у гостя нет. */
  enabled: boolean;
  products: Array<{
    id: string;
    name: string;
    category: string | null;
    price: number;
    /** Остаток, если он ведётся: экран не даёт положить в корзину больше. */
    stock: number | null;
  }>;
}

/**
 * Что показать гостю после оформления заказа: счёт на оплату картой.
 * Форма повторяет пополнение с ПК — экран агента один и тот же.
 */
export type PlaceOrderResult =
  | {
      ok: true;
      orderId: string;
      total: number;
      intentId: string;
      /** kaspi_qr — QR счёта на сумму; kaspi_phone — счёт в приложение Kaspi на номер гостя. */
      mode: "dynamic" | "static" | "kaspi_qr" | "kaspi_phone";
      qrPayload: string | null;
      qrImageUrl: string | null;
      phoneMasked: string | null;
      expiresAt: Date;
    }
  | { ok: false; reason: string };

/**
 * Заказ из бара с игрового ПК.
 *
 * Гость оплачивает картой онлайн сразу при заказе. Товар снимается со склада в
 * момент заказа (бронь), чтобы два гостя не оплатили последнюю банку колы оба;
 * деньгами заказ становится продажей бара (ProductSale, способ ONLINE) только
 * после подтверждения оплаты — это делает платёжный сервис. Неоплаченный заказ
 * освобождает склад по таймеру. Отмена уже оплаченного возвращает товар и
 * снимает позиции из отчёта; деньги по карте возвращает администратор.
 */
@Injectable()
export class BarOrdersService {
  private readonly logger = new Logger(BarOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly kaspi: KaspiService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Меню для экрана гостя: то, что есть в наличии. */
  async menuFor(computerId: string): Promise<BarMenu> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { clubId: true, club: { select: { barOrdersFromPc: true } } },
    });
    if (!computer?.club.barOrdersFromPc)
      return { enabled: false, products: [] };

    const products = await this.prisma.product.findMany({
      where: {
        clubId: computer.clubId,
        isActive: true,
        OR: [{ stock: null }, { stock: { gt: 0 } }],
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return {
      enabled: true,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        stock: p.stock,
      })),
    };
  }

  /**
   * Гость сессии этой машины заказывает. Кто гость — решает шлюз по сессии
   * машины; номер гостя от экрана не принимается. В ответ — счёт на оплату
   * картой: пока он не оплачен, кассе заказ не показывается.
   */
  async place(
    computerId: string,
    guestId: string,
    rawLines: unknown,
    method: TopUpMethod,
  ): Promise<PlaceOrderResult> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };
    if (!computer.club.barOrdersFromPc) {
      return {
        ok: false,
        reason: "Заказ из бара с компьютера в этом клубе выключен",
      };
    }

    const parsed = normalizeOrderLines(rawLines);
    if (!parsed.ok) return parsed;

    const session = await this.prisma.session.findFirst({
      where: { computerId, guestId, status: SessionStatus.ACTIVE },
      select: { id: true },
    });
    if (!session) return { ok: false, reason: "Заказать можно во время игры" };

    // Бронь склада и сам заказ — одной транзакцией. Деньги здесь не трогаем:
    // позиции станут продажами при подтверждении оплаты.
    let orderId: string;
    let total: number;
    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const items: OrderItemSnapshot[] = [];
        for (const line of parsed.lines) {
          const product = await tx.product.findUnique({
            where: { id: line.productId },
          });
          if (
            !product ||
            product.clubId !== computer.clubId ||
            !product.isActive
          ) {
            throw new BadRequestException(
              "Одной из позиций больше нет в меню — обновите корзину",
            );
          }
          if (product.stock !== null) {
            // Условное списание: два заказа на последнюю штуку не пройдут оба.
            const taken = await tx.product.updateMany({
              where: { id: product.id, stock: { gte: line.quantity } },
              data: { stock: { decrement: line.quantity } },
            });
            if (taken.count === 0) {
              throw new BadRequestException(
                `«${product.name}» закончился или осталось меньше`,
              );
            }
          }
          items.push({
            productId: product.id,
            name: product.name,
            quantity: line.quantity,
            price: product.price,
          });
        }

        const sum = orderTotal(items);
        const created = await tx.barOrder.create({
          data: {
            tenantId: computer.club.tenantId,
            clubId: computer.clubId,
            guestId,
            sessionId: session.id,
            computerId,
            computerName: computer.name,
            status: BarOrderStatus.AWAITING_PAYMENT,
            total: sum,
            bonusAccrued: 0,
            items: items as unknown as Prisma.InputJsonValue,
          },
        });
        return { id: created.id, total: sum };
      });
      orderId = order.id;
      total = order.total;
    } catch (error) {
      if (error instanceof BadRequestException)
        return { ok: false, reason: error.message };
      this.logger.error("Заказ из бара не оформился", error as Error);
      return { ok: false, reason: "Не удалось оформить заказ" };
    }

    // Счёт Kaspi под этот заказ. Не выставился — освобождаем склад и снимаем заказ.
    const checkout = await this.kaspi.createForBarOrder(
      computerId,
      guestId,
      orderId,
      total,
      method,
    );
    if (!checkout.ok) {
      await this.release(orderId);
      return { ok: false, reason: checkout.reason };
    }

    return {
      ok: true,
      orderId,
      total,
      intentId: checkout.intentId,
      mode: checkout.mode,
      qrPayload: checkout.qrPayload,
      qrImageUrl: checkout.qrImageUrl,
      phoneMasked: checkout.phoneMasked,
      expiresAt: checkout.expiresAt,
    };
  }

  /** Заказы для кассы: оплаченные и ждущие, плюс последние закрытые. */
  async list(staff: AuthenticatedStaff, clubId: string) {
    await this.access.requireClub(staff, clubId);
    const since = new Date(Date.now() - 12 * 60 * 60_000);
    const orders = await this.prisma.barOrder.findMany({
      where: {
        clubId,
        OR: [{ status: BarOrderStatus.NEW }, { handledAt: { gte: since } }],
      },
      include: { guest: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return orders.map((o) => ({
      id: o.id,
      status: o.status,
      computerName: o.computerName,
      guestName: o.guest.fullName,
      total: o.total,
      items: o.items as unknown as OrderItemSnapshot[],
      createdAt: o.createdAt,
      handledAt: o.handledAt,
    }));
  }

  /** Отнесли гостю. */
  async complete(staff: AuthenticatedStaff, clubId: string, orderId: string) {
    await this.access.requireClub(staff, clubId);
    const order = await this.requireOrder(clubId, orderId);

    const changed = await this.prisma.barOrder.updateMany({
      where: { id: order.id, status: BarOrderStatus.NEW },
      data: {
        status: BarOrderStatus.DONE,
        handledById: staff.id,
        handledAt: new Date(),
      },
    });
    if (changed.count === 0) throw new BadRequestException("Заказ уже закрыт");

    this.bus.emit("bar.order.updated", {
      clubId,
      computerId: order.computerId,
      orderId: order.id,
      status: "DONE",
    });
    return { ok: true };
  }

  /**
   * Отмена оплаченного заказа: товар на склад, продажи из отчёта, бонусы обратно.
   * Деньги по карте возвращает администратор вручную — автоматически карту не
   * вернуть. Всё одной транзакцией: половинчатая отмена хуже никакой.
   */
  async cancel(staff: AuthenticatedStaff, clubId: string, orderId: string) {
    await this.access.requireClub(staff, clubId);
    const order = await this.requireOrder(clubId, orderId);
    const items = order.items as unknown as OrderItemSnapshot[];

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.barOrder.updateMany({
        where: { id: order.id, status: BarOrderStatus.NEW },
        data: {
          status: BarOrderStatus.CANCELED,
          handledById: staff.id,
          handledAt: new Date(),
        },
      });
      if (changed.count === 0)
        throw new BadRequestException("Заказ уже закрыт");

      for (const item of items) {
        // Остаток возвращается только тем товарам, у которых он ведётся.
        await tx.product.updateMany({
          where: { id: item.productId, stock: { not: null } },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.productSale.deleteMany({ where: { orderId: order.id } });

      if (order.bonusAccrued > 0) {
        await tx.guest.update({
          where: { id: order.guestId },
          data: { bonusPoints: { decrement: order.bonusAccrued } },
        });
      }
    });

    this.bus.emit("bar.order.updated", {
      clubId,
      computerId: order.computerId,
      orderId: order.id,
      status: "CANCELED",
    });
    return { ok: true };
  }

  /**
   * Неоплаченные заказы освобождают склад. Банк о провале счёта сообщает сам,
   * но весть может потеряться — поэтому раз в минуту снимаем висящие: те, чей
   * счёт истёк или отклонён, и совсем старые. Оплаченные (их счёт SUCCEEDED)
   * не трогаем.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async releaseStale(): Promise<void> {
    const graceCutoff = new Date(Date.now() - 2 * 60_000);
    const hardCutoff = new Date(Date.now() - 35 * 60_000);
    const orders = await this.prisma.barOrder.findMany({
      where: {
        status: BarOrderStatus.AWAITING_PAYMENT,
        createdAt: { lt: graceCutoff },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    if (orders.length === 0) return;

    for (const order of orders) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: { barOrderId: order.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      if (intent?.status === PaymentIntentStatus.SUCCEEDED) continue;
      const dead =
        !intent ||
        intent.status === PaymentIntentStatus.FAILED ||
        intent.status === PaymentIntentStatus.EXPIRED ||
        intent.status === PaymentIntentStatus.CANCELED ||
        order.createdAt < hardCutoff;
      if (!dead) continue;

      const released = await this.release(order.id);
      if (released) {
        this.bus.emit("bar.order.failed", {
          clubId: order.clubId,
          computerId: order.computerId,
          orderId: order.id,
          intentId: intent?.id ?? "",
          reason: "Оплата не поступила",
        });
      }
    }
  }

  /** Вернуть бронь склада и снять неоплаченный заказ. true — сняли этим вызовом. */
  private async release(orderId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.barOrder.findUnique({ where: { id: orderId } });
      if (!order || order.status !== BarOrderStatus.AWAITING_PAYMENT)
        return false;
      const changed = await tx.barOrder.updateMany({
        where: { id: orderId, status: BarOrderStatus.AWAITING_PAYMENT },
        data: { status: BarOrderStatus.CANCELED },
      });
      if (changed.count === 0) return false;

      const items = order.items as unknown as OrderItemSnapshot[];
      for (const item of items) {
        await tx.product.updateMany({
          where: { id: item.productId, stock: { not: null } },
          data: { stock: { increment: item.quantity } },
        });
      }
      return true;
    });
  }

  private async requireOrder(clubId: string, orderId: string) {
    const order = await this.prisma.barOrder.findUnique({
      where: { id: orderId },
    });
    if (!order || order.clubId !== clubId)
      throw new NotFoundException("Заказ не найден");
    return order;
  }
}
