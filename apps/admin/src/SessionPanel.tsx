import { useState } from "react";

import {
  type Club,
  type HallCell,
  api,
  formatDuration,
  formatMoney,
  toTiyn,
} from "./api.js";
import { PcMessageBox } from "./PcMessageBox.js";

/** Управление идущей сессией: продлить нельзя молча — всё пишется в отрезки. */
export function SessionPanel({
  club,
  cell,
  freeComputers,
  onDone,
  onOpenGuest,
}: {
  club: Club;
  cell: HallCell;
  freeComputers: HallCell[];
  onDone: () => void;
  /** Открыть карточку гостя, сидящего за этим ПК. */
  onOpenGuest: (guestId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [amount, setAmount] = useState("1000");

  const session = cell.session!;

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
        <span className={`chip ${session.onCredit ? "credit" : "in-use"}`}>
          {session.status === "PAUSED"
            ? "пауза"
            : session.onCredit
              ? "в долг"
              : "играет"}
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      {session.onCredit && (
        <div className="notice warn">
          Баланс исчерпан, гость играет в долг. Осталось{" "}
          {formatMoney(session.creditLeft ?? 0)} — подойдите и предложите
          пополнение.
        </div>
      )}

      <div className="section">
        <h3>Сессия</h3>
        <div className="rows">
          <div className="row">
            <span className="k">Гость</span>
            <span>
              {session.guest
                ? `${session.guest.fullName} · ${session.guest.phone}`
                : "Без аккаунта"}
            </span>
          </div>
          {session.guest && (
            <div className="row">
              <span className="k">Аккаунт</span>
              <button
                className="link"
                onClick={() => onOpenGuest(session.guest!.id)}
              >
                Открыть аккаунт и историю
              </button>
            </div>
          )}
          <div className="row">
            <span className="k">Идёт</span>
            <span>{formatDuration(session.startedAt)}</span>
          </div>
          <div className="row">
            <span className="k">Режим</span>
            <span>
              {session.mode === "PACKAGE" ? "Минуты пакета" : "Поминутно"}
            </span>
          </div>
          {session.packageMinutesLeft !== null && (
            <div className="row">
              <span className="k">Осталось минут</span>
              <span>{session.packageMinutesLeft}</span>
            </div>
          )}
          {session.balance !== null && (
            <div className="row">
              <span className="k">Баланс</span>
              <span>{formatMoney(session.balance)}</span>
            </div>
          )}
          {session.minutesAffordable !== null &&
            session.mode === "PER_MINUTE" && (
              <div className="row">
                <span className="k">Хватит на</span>
                <span>{session.minutesAffordable} мин</span>
              </div>
            )}
          <div className="row">
            <span className="k">Начислено</span>
            <span>{formatMoney(session.totalCharged)}</span>
          </div>
          <div className="row">
            <span className="k">Открыл</span>
            <span>
              {session.startedBy === "GUEST" ? "Гость сам" : "Администратор"}
            </span>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Действия</h3>
        <div className="actions">
          {session.status === "ACTIVE" ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(() => api.pauseSession(club.id, session.id))
              }
            >
              Пауза
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() =>
                void run(() => api.resumeSession(club.id, session.id))
              }
            >
              Продолжить
            </button>
          )}
          <button
            className="danger"
            disabled={busy}
            onClick={() => void run(() => api.stopSession(club.id, session.id))}
          >
            Завершить
          </button>
        </div>
      </div>

      <div className="section">
        <h3>Пересадить</h3>
        {/* В своей зоне отрезок не прерывается; в другой — минуты пакета
            остаются на аккаунте и ждут возвращения в свою зону. */}
        <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
          <option value="">Куда пересадить…</option>
          {freeComputers.map((target) => (
            <option key={target.computer.id} value={target.computer.id}>
              {target.computer.name} · {target.computer.zone.name}
              {target.computer.zone.id !== cell.computer.zone.id
                ? " (другая зона)"
                : ""}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !moveTo}
          onClick={() =>
            void run(() => api.moveSession(club.id, session.id, moveTo))
          }
        >
          Пересадить
        </button>
      </div>

      {/* Пополнение счёта прямо из сессии: кассиру не нужно идти в «Гости». */}
      {session.guest && (
        <div className="section">
          <h3>Пополнить счёт</h3>
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
              onClick={() =>
                void run(() =>
                  api.topUp(
                    club.id,
                    session.guest!.id,
                    toTiyn(amount),
                    "CASH",
                  ),
                )
              }
            >
              Наличными
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api.topUp(
                    club.id,
                    session.guest!.id,
                    toTiyn(amount),
                    "CARD",
                  ),
                )
              }
            >
              Картой
            </button>
          </div>
        </div>
      )}

      <div className="section">
        <h3>Сообщение на экран</h3>
        <PcMessageBox
          clubId={club.id}
          computerId={cell.computer.id}
          placeholder="Текст гостю на этот ПК…"
        />
      </div>
    </>
  );
}
