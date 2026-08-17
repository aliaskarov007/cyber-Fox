import { type FormEvent, useState } from "react";

import { type Club, api } from "./api.js";

/**
 * Заведение гостя на стойке.
 *
 * PIN здесь необязателен, но без него гость не сможет сесть за машину сам: вход
 * по телефону и PIN — один из двух путей, и второй требует администратора на
 * каждую посадку.
 */
export function GuestNewForm({ club, onCreated }: { club: Club; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (pin !== "" && !/^\d{4}$/.test(pin)) throw new Error("PIN — четыре цифры");
      const guest = await api.createGuest(club.id, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        ...(pin === "" ? {} : { pin }),
      });
      setFullName("");
      setPhone("");
      setPin("");
      setOpen(false);
      onCreated(guest.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="primary" type="button" onClick={() => setOpen(true)}>
        Новый гость
      </button>
    );
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      <label>
        Имя
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Асхат" />
      </label>

      <label>
        Телефон
        <input
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+77010000001"
        />
      </label>

      <label>
        PIN, 4 цифры (можно позже)
        <input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          Завести
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
