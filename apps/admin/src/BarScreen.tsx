import { useCallback, useEffect, useMemo, useState } from "react";

import { type Club, type Guest, type Product, api, formatMoney } from "./api.js";
import { ProductsSection } from "./ProductsSection.js";

/**
 * Бар. Продажа — самая частая операция после посадки, поэтому товар продаётся
 * в два касания: выбрать позицию, выбрать способ оплаты.
 */
export function BarScreen({ club }: { club: Club }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setProducts(await api.products(club.id));
  }, [club.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setFound([]);
      return;
    }
    const timer = setTimeout(async () => {
      setFound(await api.searchGuests(club.id, query));
    }, 200);
    return () => clearTimeout(timer);
  }, [club.id, query]);

  const categories = useMemo(() => {
    const grouped = new Map<string, Product[]>();
    for (const product of products.filter((p) => p.isActive)) {
      const key = product.category ?? "Прочее";
      grouped.set(key, [...(grouped.get(key) ?? []), product]);
    }
    return [...grouped.entries()];
  }, [products]);

  async function sell(method: string): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.sellProduct(club.id, {
        productId: selected.id,
        quantity,
        method,
        guestId: guest?.id,
      });
      setDone(`${selected.name} ×${quantity} — ${formatMoney(selected.price * quantity)}`);
      setSelected(null);
      setQuantity(1);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      {done && <div className="notice">Продано: {done}</div>}
      {error && <div className="error">{error}</div>}

      {/* Правка товаров живёт рядом с продажей: цену меняют у стойки и в смену,
          а не в отдельном разделе настроек, куда администратор не заходит. */}
      <ProductsSection club={club} products={products} onChanged={() => void refresh()} />

      {categories.map(([category, items]) => (
        <section className="zone-block" key={category}>
          <div className="zone-head">
            <h2>{category}</h2>
          </div>
          <div className="hall-grid">
            {items.map((product) => (
              <button
                key={product.id}
                className="pc"
                data-state={product.stock !== null && product.stock === 0 ? "MAINTENANCE" : "IDLE"}
                disabled={product.stock !== null && product.stock === 0}
                onClick={() => {
                  setSelected(product);
                  setQuantity(1);
                  setDone(null);
                }}
              >
                <div className="pc-head">
                  <span className="pc-name">{product.name}</span>
                  {/* Остаток показывается только там, где он ведётся. */}
                  {product.stock !== null && (
                    <span className={`chip ${product.stock === 0 ? "maintenance" : "idle"}`}>
                      {product.stock === 0 ? "нет" : `${product.stock} шт`}
                    </span>
                  )}
                </div>
                <div className="pc-body">
                  <span className="pc-line">{formatMoney(product.price)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {selected && (
        <>
          <button className="backdrop" aria-label="Закрыть" onClick={() => setSelected(null)} />
          <aside className="drawer">
            <div className="drawer-head">
              <h2>{selected.name}</h2>
              <span className="chip idle">{formatMoney(selected.price)}</span>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="section">
              <h3>Количество</h3>
              <div className="actions">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-pressed={quantity === n} onClick={() => setQuantity(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="row">
                <span className="k">Итого</span>
                <span>{formatMoney(selected.price * quantity)}</span>
              </div>
            </div>

            <div className="section">
              <h3>Гость (для оплаты с баланса и бонусов)</h3>
              <input
                placeholder="Телефон или имя"
                value={guest ? guest.fullName : query}
                onChange={(e) => {
                  setGuest(null);
                  setQuery(e.target.value);
                }}
              />
              <div className="guest-list">
                {found.map((item) => (
                  <button
                    key={item.id}
                    className="guest-item"
                    aria-pressed={guest?.id === item.id}
                    onClick={() => {
                      setGuest(item);
                      setFound([]);
                    }}
                  >
                    <span>{item.fullName}</span>
                    <span className="phone">{item.phone}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="section">
              <h3>Оплата</h3>
              <div className="actions">
                <button className="primary" disabled={busy} onClick={() => void sell("CASH")}>
                  Наличными
                </button>
                <button disabled={busy} onClick={() => void sell("CARD")}>
                  Картой
                </button>
                <button disabled={busy || !guest} onClick={() => void sell("BALANCE")}>
                  С баланса гостя
                </button>
              </div>
            </div>

            <button onClick={() => setSelected(null)}>Отмена</button>
          </aside>
        </>
      )}
    </main>
  );
}
