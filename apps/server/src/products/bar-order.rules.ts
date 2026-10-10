/**
 * Правила заказа из бара с игрового ПК — без базы, чтобы проверять на числах.
 */

/** Больше двадцати штук одной позиции с игрового ПК — почти наверняка опечатка. */
export const MAX_QUANTITY_PER_LINE = 20;
export const MAX_LINES = 20;

export interface OrderLineInput {
  productId: string;
  quantity: number;
}

/**
 * Позиции заказа: одинаковые товары складываются, пустые и кривые отбрасываются
 * с объяснением. Корзину собирает экран гостя, и сервер не верит ей на слово.
 */
export function normalizeOrderLines(
  input: unknown,
): { ok: true; lines: OrderLineInput[] } | { ok: false; reason: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, reason: "Корзина пуста" };
  }

  const merged = new Map<string, number>();
  for (const raw of input) {
    const line = raw as Partial<OrderLineInput> | null;
    if (!line || typeof line.productId !== "string" || line.productId.length === 0) {
      return { ok: false, reason: "В заказе неизвестная позиция" };
    }
    if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, reason: "Количество — целое число от одного" };
    }
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
  }

  if (merged.size > MAX_LINES) return { ok: false, reason: "Слишком много позиций в одном заказе" };
  for (const quantity of merged.values()) {
    if (quantity > MAX_QUANTITY_PER_LINE) {
      return { ok: false, reason: `Не больше ${MAX_QUANTITY_PER_LINE} штук одной позиции` };
    }
  }

  return {
    ok: true,
    lines: [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity })),
  };
}

export interface OrderItemSnapshot {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export function orderTotal(items: OrderItemSnapshot[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/** Строка для истории счёта: «Кола ×2, Чипсы» — без цен, они в заказе. */
export function orderSummary(items: OrderItemSnapshot[]): string {
  return items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ");
}
