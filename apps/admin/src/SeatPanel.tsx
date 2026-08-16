import { useEffect, useState } from "react";

import {
  type Club,
  type Guest,
  type GuestCard,
  type HallCell,
  type Tariff,
  api,
  formatMoney,
} from "./api.js";

/**
 * Посадка гостя. Порядок полей повторяет порядок действий на стойке:
 * сначала кто, потом чем платит, потом кнопка.
 */
export function SeatPanel({
  club,
  cell,
  tariffs,
  onDone,
}: {
  club: Club;
  cell: HallCell;
  tariffs: Tariff[];
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Guest[]>([]);
  const [selected, setSelected] = useState<Guest | null>(null);
  const [card, setCard] = useState<GuestCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const zoneId = cell.computer.zone.id;
  const zoneTariffs = tariffs.filter((t) => t.zoneId === zoneId && t.isActive);
  const perMinute = zoneTariffs.filter((t) => t.kind === "PER_MINUTE");
  const packages = zoneTariffs.filter((t) => t.kind === "PACKAGE");

  // Минуты гостя, действующие за этим ПК, и минуты, которые здесь не работают.
  const minutesHere = card?.packages.filter((p) => p.zoneId === zoneId) ?? [];
  const minutesElsewhere = card?.packages.filter((p) => p.zoneId !== zoneId) ?? [];

  // Долг блокирует начало новой сессии и покупку пакета. Сервер откажет всё равно,
  // но узнать об этом до нажатия — экономия времени очереди у стойки.
  const inDebt = (card?.balance ?? 0) < 0;
  const canStart = selected !== null && !inDebt && !busy;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const guests = await api.searchGuests(club.id, query);
        if (!cancelled) setFound(guests);
      } catch {
        /* поиск не должен ломать экран посадки */
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [club.id, query]);

  async function pick(guest: Guest): Promise<void> {
    setSelected(guest);
    setCard(await api.guestCard(club.id, guest.id));
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-head">
        <h2>{cell.computer.name}</h2>
        <span className="chip idle">{cell.computer.zone.name}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="section">
        <h3>Гость</h3>
        <input
          placeholder="Телефон или имя"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="guest-list">
          {found.map((guest) => (
            <button
              key={guest.id}
              className="guest-item"
              aria-pressed={selected?.id === guest.id}
              onClick={() => void pick(guest)}
            >
              <span>{guest.fullName}</span>
              <span className="phone">{guest.phone}</span>
            </button>
          ))}
          {found.length === 0 && <div className="notice">Никого не нашли</div>}
        </div>
      </div>

      {card && (
        <div className="section">
          <h3>Счёт гостя</h3>
          <div className="rows">
            <div className="row">
              <span className="k">Баланс</span>
              <span>{formatMoney(card.balance)}</span>
            </div>
            {card.balance < 0 && (
              <div className="notice warn">
                На счету долг. Сначала погасите его — новую сессию начать нельзя.
              </div>
            )}
            {minutesHere.map((p) => (
              <div className="row" key={p.id}>
                <span className="k">Минуты в этой зоне</span>
                <span>{p.minutesRemaining} мин</span>
              </div>
            ))}
            {minutesElsewhere.length > 0 && (
              <div className="notice">
                Есть минуты в другой зоне — здесь они не действуют:{" "}
                {minutesElsewhere.map((p) => `${p.minutesRemaining} мин`).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {card && packages.length > 0 && (
        <div className="section">
          <h3>Продать пакет</h3>
          <div className="actions">
            {packages.map((tariff) => (
              <button
                key={tariff.id}
                disabled={busy || inDebt}
                onClick={() =>
                  void run(() => api.buyPackage(club.id, card.guest.id, tariff.id, "CASH"))
                }
              >
                {tariff.name} · {formatMoney(tariff.packagePrice ?? 0)}
              </button>
            ))}
          </div>
          <TopUp club={club} guestId={card.guest.id} onDone={() => void pick(card.guest)} />
        </div>
      )}

      <div className="section">
        <h3>Начать сессию</h3>

        {minutesHere.length > 0 && (
          <button
            className="primary"
            disabled={!canStart}
            onClick={() =>
              void run(() =>
                api.startSession(club.id, { computerId: cell.computer.id, guestId: selected!.id }),
              )
            }
          >
            На минутах пакета ({minutesHere[0].minutesRemaining} мин)
          </button>
        )}

        {perMinute.map((tariff) => (
          <button
            key={tariff.id}
            disabled={!canStart}
            onClick={() =>
              void run(() =>
                api.startSession(club.id, {
                  computerId: cell.computer.id,
                  guestId: selected!.id,
                  tariffId: tariff.id,
                }),
              )
            }
          >
            {tariff.name} · {formatMoney(tariff.pricePerMinute ?? 0)}/мин
          </button>
        ))}

        {/* Анонимная посадка: без кредита и без остатков пакета — только предоплата. */}
        <button
          disabled={busy || perMinute.length === 0}
          onClick={() =>
            void run(() =>
              api.startSession(club.id, {
                computerId: cell.computer.id,
                tariffId: perMinute[0]?.id,
              }),
            )
          }
        >
          Без аккаунта, по предоплате
        </button>
      </div>
    </>
  );
}

function TopUp({
  club,
  guestId,
  onDone,
}: {
  club: Club;
  guestId: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);

  return (
    <div className="actions">
      <input
        style={{ width: 110 }}
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Сумма пополнения в тенге"
      />
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            // На стойке вводят тенге, сервер считает в тиын.
            await api.topUp(club.id, guestId, Math.round(Number(amount) * 100), "CASH");
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      >
        Пополнить наличными
      </button>
    </div>
  );
}
