import { type FormEvent, useState } from "react";

import { type Club, api } from "./api.js";

/**
 * Личная скидка гостя в процентах на игровое время (поминутная оплата и
 * покупка пакетов). Бар и товары — по прейскуранту. 0 — без скидки.
 */
export function GuestDiscountForm({
  club,
  guestId,
  current,
  onChanged,
}: {
  club: Club;
  guestId: string;
  current: number;
  onChanged: () => void;
}) {
  const [percent, setPercent] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const value = Number(percent);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error("Скидка — от 0 до 100%");
      }
      await api.setGuestDiscount(club.id, guestId, Math.round(value));
      setDone(true);
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}
      {done && (
        <div className="notice">
          Скидка сохранена — действует со следующей минуты.
        </div>
      )}

      <label>
        Скидка, %
        <input
          inputMode="numeric"
          maxLength={3}
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
      </label>

      <button className="primary" type="submit" disabled={busy}>
        Сохранить
      </button>
    </form>
  );
}
