import { useEffect, useState } from "react";

import {
  type Club,
  type Guest,
  type GuestCard,
  type GuestHistory,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

const TRANSACTION_LABEL: Record<string, string> = {
  TOPUP: "Пополнение",
  SESSION_CHARGE: "Игра",
  PACKAGE_PURCHASE: "Покупка пакета",
  PRODUCT_SALE: "Бар",
  REFUND: "Возврат",
  ADJUSTMENT: "Корректировка",
  DEBT_WRITE_OFF: "Списание долга",
  BONUS_ACCRUAL: "Начисление бонусов",
  BONUS_SPEND: "Списание бонусов",
};

export function GuestsScreen({ club }: { club: Club }) {
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setGuests(await api.searchGuests(club.id, query));
    }, 200);
    return () => clearTimeout(timer);
  }, [club.id, query]);

  return (
    <main>
      <div className="section" style={{ borderTop: "none", paddingTop: 0, marginBottom: 16 }}>
        <input
          placeholder="Телефон или имя"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 420 }}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Гость</th>
              <th>Телефон</th>
              <th>Бонусы</th>
              <th>PIN</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {guests.map((guest) => (
              <tr key={guest.id}>
                <td>{guest.fullName}</td>
                <td className="num">{guest.phone}</td>
                <td className="num">{formatMoney(guest.bonusPoints)}</td>
                <td>{guest.hasPin ? "задан" : "—"}</td>
                <td>
                  <button onClick={() => setSelectedId(guest.id)}>Карточка</button>
                </td>
              </tr>
            ))}
            {guests.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>
                  Никого не нашли
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <>
          <button className="backdrop" aria-label="Закрыть" onClick={() => setSelectedId(null)} />
          <aside className="drawer">
            <GuestCardPanel
              club={club}
              guestId={selectedId}
              onClose={() => setSelectedId(null)}
              onChanged={() => setQuery((q) => q)}
            />
          </aside>
        </>
      )}
    </main>
  );
}

function GuestCardPanel({
  club,
  guestId,
  onClose,
  onChanged,
}: {
  club: Club;
  guestId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<GuestCard | null>(null);
  const [history, setHistory] = useState<GuestHistory | null>(null);
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [nextCard, nextHistory] = await Promise.all([
      api.guestCard(club.id, guestId),
      api.guestHistory(club.id, guestId),
    ]);
    setCard(nextCard);
    setHistory(nextHistory);
  }

  useEffect(() => {
    void load();
  }, [club.id, guestId]);

  if (!card) return <div className="notice">Загружаем…</div>;

  const inDebt = card.balance < 0;

  return (
    <>
      <div className="drawer-head">
        <h2>{card.guest.fullName}</h2>
        <span className="chip idle">{card.guest.phone}</span>
      </div>

      {error && <div className="error">{error}</div>}

      {inDebt && (
        <div className="notice warn">
          Долг {formatMoney(Math.abs(card.balance))}. Пока он не погашен, новую сессию начать
          нельзя.
        </div>
      )}

      <div className="section">
        <h3>Счёт</h3>
        <div className="rows">
          <div className="row">
            <span className="k">Баланс</span>
            <span>{formatMoney(card.balance)}</span>
          </div>
          <div className="row">
            <span className="k">Бонусы</span>
            <span>{formatMoney(card.guest.bonusPoints)}</span>
          </div>
          <div className="row">
            <span className="k">Кошелёк</span>
            {/* Общий кошелёк сети не привязан к клубу — это видно по пустому clubId. */}
            <span>{card.walletClubId === null ? "общий по сети" : "этого клуба"}</span>
          </div>
        </div>

        <div className="actions">
          <input
            style={{ width: 120 }}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Сумма пополнения в тенге"
          />
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.topUp(club.id, guestId, toTiyn(amount), "CASH");
                await load();
                onChanged();
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Пополнить наличными
          </button>
        </div>
      </div>

      {card.packages.length > 0 && (
        <div className="section">
          <h3>Минуты на аккаунте</h3>
          <div className="rows">
            {card.packages.map((p) => (
              <div className="row" key={p.id}>
                <span className="k">{p.minutesRemaining} мин</span>
                <span>до {new Date(p.expiresAt).toLocaleDateString("ru-KZ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {history && history.sessions.length > 0 && (
        <div className="section">
          <h3>Последние визиты</h3>
          <div className="rows">
            {history.sessions.slice(0, 8).map((s) => (
              <div className="row" key={s.id}>
                <span className="k">
                  {new Date(s.startedAt).toLocaleString("ru-KZ", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {s.computerName}
                </span>
                <span>{formatMoney(s.totalCharged)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {history && history.transactions.length > 0 && (
        <div className="section">
          <h3>Движение по счёту</h3>
          <div className="rows">
            {history.transactions.slice(0, 10).map((t) => (
              <div className="row" key={t.id}>
                <span className="k">
                  {TRANSACTION_LABEL[t.type] ?? t.type}
                  {t.comment ? ` · ${t.comment}` : ""}
                  {/* Визит показывается одной строкой: сколько минут и сколько денег. */}
                  {t.minutes !== null ? ` · ${t.minutes} мин` : ""}
                </span>
                <span>{formatMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={onClose}>Закрыть</button>
    </>
  );
}
