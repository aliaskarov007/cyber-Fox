import { useState } from "react";

import { type Club, type HallCell, api, formatDuration, formatMoney } from "./api.js";

/** Управление идущей сессией: продлить нельзя молча — всё пишется в отрезки. */
export function SessionPanel({
  club,
  cell,
  freeComputers,
  onDone,
}: {
  club: Club;
  cell: HallCell;
  freeComputers: HallCell[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState("");

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
          {session.status === "PAUSED" ? "пауза" : session.onCredit ? "в долг" : "играет"}
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      {session.onCredit && (
        <div className="notice warn">
          Баланс исчерпан, гость играет в долг. Осталось{" "}
          {formatMoney(session.creditLeft ?? 0)} — подойдите и предложите пополнение.
        </div>
      )}

      <div className="section">
        <h3>Сессия</h3>
        <div className="rows">
          <div className="row">
            <span className="k">Гость</span>
            <span>{session.guest?.fullName ?? "Без аккаунта"}</span>
          </div>
          <div className="row">
            <span className="k">Идёт</span>
            <span>{formatDuration(session.startedAt)}</span>
          </div>
          <div className="row">
            <span className="k">Режим</span>
            <span>{session.mode === "PACKAGE" ? "Минуты пакета" : "Поминутно"}</span>
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
          {session.minutesAffordable !== null && session.mode === "PER_MINUTE" && (
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
            <span>{session.startedBy === "GUEST" ? "Гость сам" : "Администратор"}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Действия</h3>
        <div className="actions">
          {session.status === "ACTIVE" ? (
            <button disabled={busy} onClick={() => void run(() => api.pauseSession(club.id, session.id))}>
              Пауза
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void run(() => api.resumeSession(club.id, session.id))}
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
              {target.computer.zone.id !== cell.computer.zone.id ? " (другая зона)" : ""}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !moveTo}
          onClick={() => void run(() => api.moveSession(club.id, session.id, moveTo))}
        >
          Пересадить
        </button>
      </div>
    </>
  );
}
