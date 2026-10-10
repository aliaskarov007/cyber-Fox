import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  BarOrderStatus,
  type Prisma,
  PaymentMethod,
  SessionStatus,
  TransactionType,
} from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { WalletService } from "../guests/wallet.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { bonusFor } from "../shifts/shift.rules.js";
import {
  type OrderItemSnapshot,
  normalizeOrderLines,
  orderSummary,
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

export type PlaceOrderResult =
  | { ok: true; reason: null; orderId: string; total: number; balance: number }
  | { ok: false; reason: string };

/**
 * Заказ из бара с игрового ПК.
 *
 * Деньги списываются с баланса в момент заказа, товар — со склада: администратор
 * несёт уже оплаченное, а два гостя не закажут последнюю банку колы оба.
 * Отмена возвращает и то и другое. Позиции — обычные продажи бара, поэтому
 * отчёт по выручке и марже о заказах с ПК знать ничего не должен.
 */
@Injectable()
export class BarOrdersService {
  private readonly logger = new Logger(BarOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly wallets: WalletService,
    private readonly sessions: SessionsService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Меню для экрана гостя: то, что есть в наличии. */
  async menuFor(computerId: string): Promise<BarMenu> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      select: { clubId: true, club: { select: { barOrdersFromPc: true } } },
    });
    if (!computer?.club.barOrdersFromPc) return { enabled: false, products: [] };

    const products = await this.prisma.product.findMany({
      where: { clubId: computer.clubId, isActive: true, OR: [{ stock: null }, { stock: { gt: 0 } }] },
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
   * машины; номер гостя от экрана не принимается.
   */
  async place(computerId: string, guestId: string, rawLines: unknown): Promise<PlaceOrderResult> {
    const computer = await this.prisma.computer.findUnique({
      where: { id: computerId },
      include: { club: true },
    });
    if (!computer) return { ok: false, reason: "ПК не опознан" };
    if (!computer.club.barOrdersFromPc) {
      return { ok: false, reason: "Заказ из бара с компьютера в этом клубе выключен" };
    }

    const parsed = normalizeOrderLines(rawLines);
    if (!parsed.ok) return parsed;

    const session = await this.prisma.session.findFirst({
      where: { computerId, guestId, status: SessionStatus.ACTIVE },
      select: { id: true },
    });
    if (!session) return { ok: false, reason: "Заказать можно во время игры" };

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const items: OrderItemSnapshot[] = [];
        const products = new Map<string, { cost: number }>();

        for (const line of parsed.lines) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product || product.clubId !== computer.clubId || !product.isActive) {
            throw new BadRequestException("Одной из позиций больше нет в меню — обновите корзину");
          }
          if (product.stock !== null) {
            // Условное списание: два заказа на последнюю штуку не пройдут оба.
            const taken = await tx.product.updateMany({
              where: { id: product.id, stock: { gte: line.quantity } },
              data: { stock: { decrement: line.quantity } },
            });
            if (taken.count === 0) {
              throw new BadRequestException(`«${product.name}» закончился или осталось меньше`);
            }
          }
          items.push({
            productId: product.id,
            name: product.name,
            quantity: line.quantity,
            price: product.price,
          });
          products.set(product.id, { cost: product.cost });
        }

        const total = orderTotal(items);
        const wallet = await this.wallets.resolveWallet(guestId, computer.clubId, tx);
        // Бар в долг не продаётся — то же правило, что и на стойке.
        if (wallet.balance < total) {
          throw new BadRequestException("Недостаточно средств на счёте. Пополните баланс.");
        }

        const updated = await this.wallets.record(tx, {
          walletId: wallet.id,
          clubId: computer.clubId,
          amount: -total,
          type: TransactionType.PRODUCT_SALE,
          sessionId: session.id,
          comment: `Бар с ${computer.name}: ${orderSummary(items)}`,
        });

        const bonus = bonusFor(total, computer.club.bonusPercent);
        if (bonus > 0) {
          await tx.guest.update({
            where: { id: guestId },
            data: { bonusPoints: { increment: bonus } },
          });
        }

        const shift = await tx.shift.findFirst({
          where: { clubId: computer.clubId, closedAt: null },
          orderBy: { openedAt: "desc" },
        });

        const created = await tx.barOrder.create({
          data: {
            tenantId: computer.club.tenantId,
            clubId: computer.clubId,
            guestId,
            sessionId: session.id,
            computerId,
            computerName: computer.name,
            total,
            bonusAccrued: bonus,
            items: items as unknown as Prisma.InputJsonValue,
          },
        });

        for (const item of items) {
          await tx.productSale.create({
            data: {
              clubId: computer.clubId,
              productId: item.productId,
              guestId,
              sessionId: session.id,
              shiftId: shift?.id ?? null,
              staffId: null,
              quantity: item.quantity,
              priceAtSale: item.price,
              costAtSale: products.get(item.productId)?.cost ?? 0,
              total: item.price * item.quantity,
              method: PaymentMethod.BALANCE,
              orderId: created.id,
            },
          });
        }

        return { id: created.id, total, balance: updated.balance };
      });

      this.bus.emit("bar.order.placed", {
        clubId: computer.clubId,
        orderId: order.id,
        computerName: computer.name,
      });
      await this.pushTick(session.id);
      return { ok: true, reason: null, orderId: order.id, total: order.total, balance: order.balance };
    } catch (error) {
      if (error instanceof BadRequestException) return { ok: false, reason: error.message };
      this.logger.error("Заказ из бара не прошёл", error as Error);
      return { ok: false, reason: "Не удалось оформить заказ" };
    }
  }

  /** Заказы для кассы: ждущие и последние закрытые. */
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
      data: { status: BarOrderStatus.DONE, handledById: staff.id, handledAt: new Date() },
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
   * Отмена: деньги на счёт, товар на склад, продажи из отчёта, бонусы обратно.
   * Всё одной транзакцией — половинчатая отмена хуже никакой.
   */
  async cancel(staff: AuthenticatedStaff, clubId: string, orderId: string) {
    await this.access.requireClub(staff, clubId);
    const order = await this.requireOrder(clubId, orderId);
    const items = order.items as unknown as OrderItemSnapshot[];

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.barOrder.updateMany({
        where: { id: order.id, status: BarOrderStatus.NEW },
        data: { status: BarOrderStatus.CANCELED, handledById: staff.id, handledAt: new Date() },
      });
      if (changed.count === 0) throw new BadRequestException("Заказ уже закрыт");

      const wallet = await this.wallets.resolveWallet(order.guestId, clubId, tx);
      await this.wallets.record(tx, {
        walletId: wallet.id,
        clubId,
        amount: order.total,
        type: TransactionType.REFUND,
        sessionId: order.sessionId,
        comment: `Отмена заказа с ${order.computerName}`,
      });

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
    if (order.sessionId) await this.pushTick(order.sessionId);
    return { ok: true };
  }

  /** Новый баланс — сразу на экран гостя и на карту зала. */
  private async pushTick(sessionId: string): Promise<void> {
    // Закончившейся сессии тик не шлём: агент принял бы его за начало игры.
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session?.status !== SessionStatus.ACTIVE) return;
    const snapshot = await this.sessions.sessionSnapshot(sessionId);
    if (snapshot) this.bus.emit("session.tick", snapshot);
  }

  private async requireOrder(clubId: string, orderId: string) {
    const order = await this.prisma.barOrder.findUnique({ where: { id: orderId } });
    if (!order || order.clubId !== clubId) throw new NotFoundException("Заказ не найден");
    return order;
  }
}
