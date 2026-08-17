import { type FormEvent, useEffect, useState } from "react";

import {
  type AgentClient,
  type GuestLoginResult,
  formatMoney,
} from "./agent-client.js";

/**
 * Экран блокировки: вход по телефону и PIN.
 *
 * Пароль на клубной клавиатуре с очередью за спиной — отказ от идеи
 * самообслуживания, поэтому телефон и четыре цифры (docs/guest-access.md).
 */
export function LockScreen({
  client,
  perMinutePrice,
  online,
  onStarted,
}: {
  client: AgentClient;
  perMinutePrice: number | null;
  /** Без связи с сервером вход невозможен: проверить PIN и баланс некому. */
  online: boolean;
  onStarted: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  /* Молчащая кнопка вызова заставляет гостя жать её ещё несколько раз, а на
     стойке это выглядит как несколько вызовов с одной машины. */
  const [called, setCalled] = useState(false);

  /*
   * Кнопка возвращается в исходное через минуту. Таймер снимается при уходе с
   * экрана: сессия заканчивается блокировкой, компонент исчезает, и оставленный
   * таймер дёргал бы состояние уже несуществующего экрана.
   */
  useEffect(() => {
    if (!called) return;
    const timer = setTimeout(() => setCalled(false), 60_000);
    return () => clearTimeout(timer);
  }, [called]);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<GuestLoginResult | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await client.login(phone, pin);
      if (!result.ok) setError(result.reason ?? "Не удалось войти");
      else setCard(result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function start(tariffId?: string): Promise<void> {
    if (!card?.guest) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.startSession(card.guest.id, tariffId);
      if (result.ok) onStarted();
      else setError(result.reason ?? "Не удалось начать сессию");
    } finally {
      setBusy(false);
    }
  }

  if (card?.guest) {
    const minutes = card.packagesInZone[0];
    return (
      <div className="card">
        <h1>Здравствуйте, {card.guest.fullName}</h1>

        {error && <div className="error">{error}</div>}

        <div className="rows">
          <div className="row">
            <span className="k">Баланс</span>
            <span>{formatMoney(card.guest.balance)}</span>
          </div>
          {minutes && (
            <div className="row">
              <span className="k">Минуты в этой зоне</span>
              <span>{minutes.minutesRemaining} мин</span>
            </div>
          )}
          {card.perMinutePrice !== null && (
            <div className="row">
              <span className="k">Поминутно</span>
              <span>{formatMoney(card.perMinutePrice)}/мин</span>
            </div>
          )}
          {card.minutesAffordable !== null && !minutes && (
            <div className="row">
              <span className="k">Хватит на</span>
              <span>{card.minutesAffordable} мин</span>
            </div>
          )}
        </div>

        {card.packagesElsewhere.length > 0 && (
          <div className="banner info">
            У вас есть минуты в другой зоне — здесь они не действуют:{" "}
            {card.packagesElsewhere
              .map((p) => `${p.zoneName} — ${p.minutesRemaining} мин`)
              .join(", ")}
          </div>
        )}

        {minutes ? (
          <button className="primary" disabled={busy} onClick={() => void start()}>
            Играть на минутах пакета ({minutes.minutesRemaining} мин)
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => void start()}>
            Начать по поминутному тарифу
          </button>
        )}

        <button className="ghost" onClick={() => setCard(null)}>
          Это не я
        </button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Вход в клуб</h1>

      {error && <div className="error">{error}</div>}

      {/* Проверить PIN и остаток без сервера нельзя — честно говорим об этом,
          вместо того чтобы принимать ввод и молча отказывать. */}
      {!online && (
        <div className="banner warn">
          Нет связи с сервером — самостоятельный вход временно недоступен. Подойдите к
          администратору.
        </div>
      )}

      <label>
        Номер телефона
        <input
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+7 700 000 00 00"
          autoFocus
        />
      </label>

      <label>
        PIN
        <input
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="····"
        />
      </label>

      <button className="primary" type="submit" disabled={busy || pin.length !== 4}>
        {busy ? "Проверяем…" : "Войти"}
      </button>

      {perMinutePrice !== null && (
        <div className="note">Поминутный тариф этой зоны — {formatMoney(perMinutePrice)}/мин.</div>
      )}

      <button
        className="ghost"
        type="button"
        disabled={called}
        onClick={() => {
          setCalled(true);
          void client.callStaff();
        }}
      >
        {called ? "Администратор идёт" : "Позвать администратора"}
      </button>
    </form>
  );
}
