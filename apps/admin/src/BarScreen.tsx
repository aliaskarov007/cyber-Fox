import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type Club,
  type Product,
  type Staff,
  api,
  formatMoney,
} from "./api.js";
import { ProductsSection } from "./ProductsSection.js";
import { SeatRequests } from "./SeatRequests.js";

/** Строка чека: товар и сколько штук набрал кассир. */
type CartLine = { product: Product; quantity: number };

/** Склонение «позиция/позиции/позиций» по числу. */
function positions(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return "позиция";
  if (ten >= 2 && ten <= 4 && (hundred < 10 || hundred >= 20)) return "позиции";
  return "позиций";
}

/**
 * Бар. Кассир набирает чек из нескольких товаров и пробивает его одной оплатой.
 * Привязки к гостю нет — касса бара продаёт анонимно, быстро и в два касания:
 * набрать позиции и выбрать способ оплаты.
 */
export function BarScreen({ club, staff }: { club: Club; staff: Staff }) {
  /** Товары заводит владелец или управляющий: сервер закрывает правку ролью. */
  const canManage = staff.role === "OWNER" || staff.role === "ADMIN";

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setProducts(await api.products(club.id));
  }, [club.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(() => {
    const grouped = new Map<string, Product[]>();
    for (const product of products.filter((p) => p.isActive)) {
      const key = product.category ?? "Прочее";
      grouped.set(key, [...(grouped.get(key) ?? []), product]);
    }
    return [...grouped.entries()];
  }, [products]);

  const cartTotal = cart.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0,
  );

  /** Остаток с учётом уже набранного в чек — чтобы не продать больше, чем есть. */
  function stockLeft(product: Product): number | null {
    if (product.stock === null) return null;
    const inCart = cart.find((l) => l.product.id === product.id)?.quantity ?? 0;
    return product.stock - inCart;
  }

  function addToCart(product: Product): void {
    setDone(null);
    setError(null);
    const left = stockLeft(product);
    if (left !== null && left <= 0) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  function setLineQuantity(productId: string, quantity: number): void {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((l) => l.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l;
        // Не даём набрать больше складского остатка.
        const capped =
          l.product.stock === null
            ? quantity
            : Math.min(quantity, l.product.stock);
        return { ...l, quantity: capped };
      }),
    );
  }

  async function checkout(method: string): Promise<void> {
    if (cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.sellCart(club.id, {
        items: cart.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
        })),
        method,
      });
      setDone(
        `${result.items} ${positions(result.items)} — ${formatMoney(result.total)}`,
      );
      setCart([]);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={cart.length > 0 ? "with-cart" : ""}>
      {/* Заказы с игровых ПК — первым делом: они уже оплачены и ждут, пока их отнесут. */}
      <SeatRequests club={club} />

      {done && <div className="notice">Продано: {done}</div>}
      {error && <div className="error">{error}</div>}

      {/* Правка товаров живёт рядом с продажей: цену меняют у стойки и в смену,
          а не в отдельном разделе настроек, куда кассир не заходит. */}
      {canManage && (
        <ProductsSection
          club={club}
          products={products}
          onChanged={() => void refresh()}
        />
      )}

      {categories.map(([category, items]) => (
        <section className="zone-block" key={category}>
          <div className="zone-head">
            <h2>{category}</h2>
          </div>
          <div className="bar-grid">
            {items.map((product) => {
              const left = stockLeft(product);
              const out = left !== null && left <= 0;
              return (
                <button
                  key={product.id}
                  className="bar-item"
                  disabled={out}
                  onClick={() => addToCart(product)}
                >
                  <div className="bar-thumb">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" />
                    ) : (
                      <span className="bar-thumb-empty" aria-hidden="true">
                        {product.name.slice(0, 1)}
                      </span>
                    )}
                    {/* Остаток показывается только там, где он ведётся. */}
                    {product.stock !== null && (
                      <span className={`bar-stock ${out ? "out" : ""}`}>
                        {out ? "нет" : `${product.stock} шт`}
                      </span>
                    )}
                  </div>
                  <div className="bar-info">
                    <span className="bar-name">{product.name}</span>
                    <span className="bar-price">
                      {formatMoney(product.price)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {cart.length > 0 && (
        <>
          {/* Чек — боковая панель без подложки: сетка товаров остаётся
              кликабельной, чтобы в один чек добавлять несколько позиций. */}
          <aside className="drawer cart-drawer">
            <div className="drawer-head">
              <h2>Чек</h2>
              <span className="chip idle">{formatMoney(cartTotal)}</span>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="section">
              <div className="cart-lines">
                {cart.map((line) => (
                  <div className="cart-line" key={line.product.id}>
                    <span className="cart-name">{line.product.name}</span>
                    <div className="cart-qty">
                      <button
                        aria-label="Меньше"
                        onClick={() =>
                          setLineQuantity(line.product.id, line.quantity - 1)
                        }
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        aria-label="Больше"
                        disabled={
                          line.product.stock !== null &&
                          line.quantity >= line.product.stock
                        }
                        onClick={() =>
                          setLineQuantity(line.product.id, line.quantity + 1)
                        }
                      >
                        +
                      </button>
                    </div>
                    <span className="cart-sum">
                      {formatMoney(line.product.price * line.quantity)}
                    </span>
                    <button
                      className="cart-del"
                      aria-label="Убрать"
                      onClick={() => setLineQuantity(line.product.id, 0)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="row">
                <span className="k">Итого</span>
                <span>{formatMoney(cartTotal)}</span>
              </div>
            </div>

            <div className="section">
              <h3>Оплата</h3>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void checkout("CASH")}
                >
                  Наличными
                </button>
                <button disabled={busy} onClick={() => void checkout("CARD")}>
                  Картой
                </button>
              </div>
            </div>

            <button onClick={() => setCart([])}>Очистить</button>
          </aside>
        </>
      )}
    </main>
  );
}
