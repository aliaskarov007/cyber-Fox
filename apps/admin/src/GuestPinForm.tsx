import { type FormEvent, useState } from "react";

import { type Club, api } from "./api.js";

/**
 * Смена PIN гостя.
 *
 * Показать прежний нельзя — он хранится хешем, как и положено. Поэтому «забыл
 * PIN» решается не подсказкой, а новым PIN, и это единственный путь.
 */
export function GuestPinForm({
  club,
  guestId,
  hasPin,
  onChanged,
}: {
  club: Club;
  guestId: string;
  hasPin: boolean;
  onChanged: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      if (!/^\d{4}$/.test(pin)) throw new Error("PIN — четыре цифры");
      await api.setGuestPin(club.id, guestId, pin);
      setPin("");
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
      {done && <div className="notice">PIN сохранён. Скажите его гостю — показать снова нельзя.</div>}

      <label>
        {hasPin ? "Новый PIN" : "Задать PIN"}
        <input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>

      <button className="primary" type="submit" disabled={busy}>
        Сохранить
      </button>
    </form>
  );
}
