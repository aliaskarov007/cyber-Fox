import { useEffect, useMemo, useState } from "react";

import { type AgentClient, type BarMenu, formatMoney } from "./agent-client.js";

type Product = BarMenu["products"][number];

/**
 * Заказ из бара с игрового ПК. Оплата — с баланса, сразу: администратор несёт
 * уже оплаченное и не ищет гостя с терминалом.
 *
 * Меню перечитывается при каждом открытии: цены и остатки меняются в смену, а
 * корзина по вчерашнему прайсу закончилась бы отказом сервера.
 */
export function BarPanel({
  client,
  balance,
  offline,
  onOrdered,
  onClose,
}: {
  client: AgentClient;
  balance: number;
  offline: boolean;
  onOrdered: (message: string) => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<Product[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void client
      .barMenu()
      .then((result) => {
        if (!result.enabled) setError("Заказ из бара с компьютера сейчас недоступен");
        setMenu(result.products);
      })
      .catch(() => setError("Не удалось загрузить меню"));
  }, [client]);

  const groups = useMemo(() => {
    const grouped = new Map<string, Product[]>();
    for (const product of menu ?? []) {
      const key = product.category ?? "Прочее";
      grouped.set(key, [...(grouped.get(key) ?? []), product]);
    }
    return [...grouped.entries()];
  }, [menu]);

  const lines = (menu ?? []).filter((p) => (cart[p.id] ?? 0) > 0);
  const total = lines.reduce((sum, p) => sum + p.price * (cart[p.id] ?? 0), 0);
  const short = total > balance;

  function change(product: Product, delta: number): void {
    setCart((current) => {
      const next = Math.max(0, (current[product.id] ?? 0) + delta);
      const limit = Math.min(20, product.stock ?? 20);
      return { ...current, [product.id]: Math.min(next, limit) };
    });
  }

  async function order(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await client.barOrder(
        lines.map((p) => ({ productId: p.id, quantity: cart[p.id] ?? 0 })),
      );
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onOrdered(`Заказ на ${formatMoney(result.total)} оплачен с баланса — администратор уже несёт.`);
      onClose();
    } catch {
      setError("Нет ответа от сервера. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bar-panel">
      <div className="bar-head">
        <h2 className="topup-title">Бар</h2>
        <span className="k">Баланс {formatMoney(balance)}</span>
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {menu === null && !error && <div className="note">Загружаем меню…</div>}
      {menu !== null && menu.length === 0 && !error && (
        <div className="note">В баре сейчас ничего нет.</div>
      )}

      {groups.map(([category, items]) => (
        <div className="bar-group" key={category}>
          <div className="bar-category">{category}</div>
          {items.map((product) => {
            const count = cart[product.id] ?? 0;
            return (
              <div className="bar-item" key={product.id}>
                <span className="bar-name">{product.name}</span>
                <span className="bar-price">{formatMoney(product.price)}</span>
                <div className="bar-qty">
                  <button type="button" disabled={count === 0} onClick={() => change(product, -1)}>
                    −
                  </button>
                  <span>{count}</span>
                  <button
                    type="button"
                    disabled={count >= Math.min(20, product.stock ?? 20)}
                    onClick={() => change(product, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {lines.length > 0 && (
        <div className="bar-total">
          <span>
            Итого <b>{formatMoney(total)}</b>
          </span>
          {short && <span className="k">Не хватает {formatMoney(total - balance)} — пополните счёт</span>}
          <button
            className="primary"
            type="button"
            disabled={busy || offline || short}
            onClick={() => void order()}
          >
            {busy ? "Оформляем…" : "Оплатить с баланса"}
          </button>
        </div>
      )}
    </div>
  );
}
