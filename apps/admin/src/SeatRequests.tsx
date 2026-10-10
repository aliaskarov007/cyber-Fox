import { useCallback, useEffect, useState } from "react";
import { type Socket, io } from "socket.io-client";

import {
  type BarOrder,
  type Club,
  type PendingQrTopUp,
  api,
  formatMoney,
  getToken,
} from "./api.js";

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-KZ", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Что ждёт кассира от игровых ПК: заказы из бара и пополнения по
 * статическому QR, которые банк сам не подтвердит.
 *
 * Полоса висит, пока есть дела, и не прячется сама — как и вызовы
 * администратора: уведомление на несколько секунд у стойки пропускают.
 */
export function SeatRequests({ club }: { club: Club }) {
  const [orders, setOrders] = useState<BarOrder[]>([]);
  const [topUps, setTopUps] = useState<PendingQrTopUp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextOrders, nextTopUps] = await Promise.all([
      api.barOrders(club.id).catch(() => []),
      api.pendingQrTopUps(club.id).catch(() => []),
    ]);
    setOrders(nextOrders.filter((o) => o.status === "NEW"));
    setTopUps(nextTopUps);
  }, [club.id]);

  useEffect(() => {
    void load();
    const token = getToken();
    if (!token) return;
    const socket: Socket = io({ auth: { token }, transports: ["websocket"] });
    for (const event of ["bar.order.placed", "bar.order.updated", "topup.pending", "topup.paid"]) {
      socket.on(event, () => void load());
    }
    // Сокет мог переподключиться, пропустив события, — догоняем раз в минуту.
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(timer);
      socket.close();
    };
  }, [load]);

  async function act(id: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (orders.length === 0 && topUps.length === 0 && !error) return null;

  return (
    <div className="calls">
      {error && <div className="error">{error}</div>}

      {orders.map((order) => (
        <div className="call" key={order.id}>
          <span className="call-name">{order.computerName}</span>
          <span className="call-time">{clock(order.createdAt)}</span>
          <span className="call-text">
            Бар · {order.guestName}:{" "}
            {order.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}{" "}
            — {formatMoney(order.total)}, оплачено с баланса
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy === order.id}
            onClick={() => void act(order.id, () => api.completeBarOrder(club.id, order.id))}
          >
            Отнёс
          </button>
          <button
            type="button"
            disabled={busy === order.id}
            onClick={() => {
              if (!window.confirm("Отменить заказ? Деньги вернутся гостю на счёт, товар — на склад.")) return;
              void act(order.id, () => api.cancelBarOrder(club.id, order.id));
            }}
          >
            Отменить
          </button>
        </div>
      ))}

      {topUps.map((topUp) => (
        <div className="call" key={topUp.id}>
          <span className="call-name">{topUp.computerName}</span>
          <span className="call-time">{clock(topUp.createdAt)}</span>
          <span className="call-text">
            Пополнение по QR · {topUp.guestName}: {formatMoney(topUp.amount)} — проверьте поступление
            в банковском приложении
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy === topUp.id}
            onClick={() =>
              void act(topUp.id, async () => {
                const result = await api.confirmPayment(topUp.id);
                if (!result.applied && result.reason) throw new Error(result.reason);
              })
            }
          >
            Деньги пришли
          </button>
          <button
            type="button"
            disabled={busy === topUp.id}
            onClick={() => void act(topUp.id, () => api.cancelPayment(topUp.id))}
          >
            Не пришли
          </button>
        </div>
      ))}
    </div>
  );
}
