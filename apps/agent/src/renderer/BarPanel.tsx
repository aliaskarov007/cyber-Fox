import { useEffect, useMemo, useState } from "react";

import {
  type AgentClient,
  type BarMenu,
  type BarOrderResult,
  formatMoney,
} from "./agent-client.js";
import { Qr } from "./QrCode.js";

type Product = BarMenu["products"][number];
type Method = "qr" | "phone";
/** Онлайн-счёт Kaspi — только у него есть intentId и QR. */
type OnlinePayment = Extract<BarOrderResult, { ok: true; intentId: string }>;

type Step =
  | { kind: "cart" }
  | { kind: "loading" }
  | { kind: "waiting"; payment: OnlinePayment }
  | { kind: "paid" };

/**
 * Заказ из бара с игрового ПК. Основная оплата — с баланса аккаунта: списывается
 * сразу, и администратору тут же падает заказ «отнести». Если баланса не хватает,
 * а клуб подключил Kaspi, можно оплатить картой онлайн (QR или счёт в приложение
 * Kaspi на номер) — тогда экран ждёт оплаты и закрывается сам.
 *
 * Меню перечитывается при каждом открытии: цены и остатки меняются в смену, а
 * корзина по вчерашнему прайсу закончилась бы отказом сервера.
 */
export function BarPanel({
  client,
  offline,
  onOrdered,
  onClose,
}: {
  client: AgentClient;
  offline: boolean;
  onOrdered: (message: string) => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<Product[] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [step, setStep] = useState<Step>({ kind: "cart" });
  const [error, setError] = useState<string | null>(null);
  const [kaspi, setKaspi] = useState(false);
  const [method, setMethod] = useState<Method>("phone");

  useEffect(() => {
    void client
      .barMenu()
      .then((result) => {
        if (!result.enabled)
          setError("Заказ из бара с компьютера сейчас недоступен");
        setMenu(result.products);
      })
      .catch(() => setError("Не удалось загрузить меню"));
  }, [client]);

  useEffect(() => {
    void client
      .topUpOptions()
      .then((options) => {
        setKaspi(options.kaspi);
        if (!options.kaspi) setMethod("qr");
      })
      .catch(() => setKaspi(false));
  }, [client]);

  const waitingFor = step.kind === "waiting" ? step.payment.orderId : null;

  useEffect(() => {
    if (!waitingFor) return;
    const offPaid = client.onBarOrderPaid((event) => {
      if (event.orderId !== waitingFor) return;
      setStep({ kind: "paid" });
      onOrdered("Заказ оплачен — администратор уже несёт. Приятного аппетита!");
    });
    const offFailed = client.onBarOrderFailed((event) => {
      if (event.orderId !== waitingFor) return;
      setError(`${event.reason}. Попробуйте ещё раз.`);
      setStep({ kind: "cart" });
    });
    return () => {
      offPaid();
      offFailed();
    };
  }, [client, waitingFor, onOrdered]);

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

  function change(product: Product, delta: number): void {
    setCart((current) => {
      const next = Math.max(0, (current[product.id] ?? 0) + delta);
      const limit = Math.min(20, product.stock ?? 20);
      return { ...current, [product.id]: Math.min(next, limit) };
    });
  }

  async function order(payMethod: "balance" | Method): Promise<void> {
    setError(null);
    setStep({ kind: "loading" });
    try {
      const result = await client.barOrder(
        lines.map((p) => ({ productId: p.id, quantity: cart[p.id] ?? 0 })),
        payMethod,
      );
      if (!result.ok) {
        setError(result.reason);
        setStep({ kind: "cart" });
        return;
      }
      // Оплата с баланса проходит сразу — ждать онлайн-оплаты не нужно.
      if (result.mode === "balance") {
        setStep({ kind: "paid" });
        onOrdered(
          "Оплачено с баланса — администратор уже несёт. Приятного аппетита!",
        );
        return;
      }
      setStep({ kind: "waiting", payment: result });
    } catch {
      setError("Нет ответа от сервера. Попробуйте ещё раз.");
      setStep({ kind: "cart" });
    }
  }

  if (step.kind === "paid") {
    return (
      <div className="bar-panel">
        <div className="banner info">
          Заказ оплачен. Администратор уже несёт — приятного аппетита!
        </div>
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    );
  }

  if (step.kind === "waiting") {
    const { payment } = step;
    return (
      <div className="bar-panel">
        <h2 className="topup-title">
          Оплата заказа · {formatMoney(payment.total)}
        </h2>

        {payment.mode === "kaspi_phone" ? (
          <ol className="steps">
            <li>
              Счёт отправлен в Kaspi на номер <b>{payment.phoneMasked}</b>.
            </li>
            <li>
              Откройте приложение Kaspi — счёт будет в уведомлениях и в разделе
              «Платежи».
            </li>
            <li>
              Подтвердите оплату — заказ уйдёт администратору через несколько
              секунд.
            </li>
          </ol>
        ) : (
          <>
            {payment.qrImageUrl ? (
              <img
                className="qr"
                src={client.resolveUrl(payment.qrImageUrl)}
                alt="QR для оплаты"
              />
            ) : payment.qrPayload ? (
              <Qr text={payment.qrPayload} label="QR для оплаты" />
            ) : null}
            <ol className="steps">
              <li>Откройте камеру или приложение Kaspi и наведите на QR.</li>
              <li>
                Сумма уже в счёте — подтвердите оплату, и заказ уйдёт
                администратору.
              </li>
            </ol>
          </>
        )}

        <div className="note">Ждём оплату… Экран обновится сам.</div>
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    );
  }

  const busy = offline || step.kind === "loading";

  return (
    <div className="bar-panel">
      <div className="bar-head">
        <h2 className="topup-title">Бар</h2>
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
                  <button
                    type="button"
                    disabled={count === 0}
                    onClick={() => change(product, -1)}
                  >
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

          {/* Основная оплата — с баланса аккаунта: списывается сразу, ничего сканировать не нужно. */}
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void order("balance")}
          >
            {step.kind === "loading" ? "Оформляем…" : "Оплатить с баланса"}
          </button>

          {/* Kaspi — запасной способ, если баланса не хватает и клуб его подключил. */}
          {kaspi && (
            <>
              <div
                className="topup-methods"
                role="radiogroup"
                aria-label="Оплата через Kaspi"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={method === "phone"}
                  className={method === "phone" ? "primary" : ""}
                  onClick={() => setMethod("phone")}
                >
                  Счёт на мой Kaspi
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={method === "qr"}
                  className={method === "qr" ? "primary" : ""}
                  onClick={() => setMethod("qr")}
                >
                  QR-код
                </button>
              </div>
              <button
                className="ghost"
                type="button"
                disabled={busy}
                onClick={() => void order(method)}
              >
                Оплатить через Kaspi
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
