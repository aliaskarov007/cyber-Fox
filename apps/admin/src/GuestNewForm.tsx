import { type FormEvent, useState } from "react";

import { type Club, api, formatMoney } from "./api.js";

/**
 * Заведение гостя на стойке.
 *
 * Обязателен только телефон: имя можно спросить потом, а PIN гость придумает
 * сам за ПК — система предложит это, как только он наберёт номер. Согласие на
 * приглашения — отдельная галочка, по умолчанию снятая: отмечается, только
 * если гость сказал «да».
 */
export function GuestNewForm({ club, onCreated }: { club: Club; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (pin !== "" && !/^\d{4}$/.test(pin)) throw new Error("PIN — четыре цифры");
      const guest = await api.createGuest(club.id, {
        phone: phone.trim(),
        ...(fullName.trim() === "" ? {} : { fullName: fullName.trim() }),
        ...(pin === "" ? {} : { pin }),
        ...(consent ? { marketingConsent: true } : {}),
      });
      setFullName("");
      setPhone("");
      setPin("");
      setConsent(false);
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
        Телефон
        <input
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="8 701 123 45 67"
          autoFocus
        />
      </label>

      <label>
        Имя (можно не заполнять)
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Асхат" />
      </label>

      <label>
        PIN (можно не задавать — гость придумает сам за ПК)
        <input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Гость согласен получать приглашения на события
        {club.consentBonus > 0 ? ` — подарок ${formatMoney(club.consentBonus)} на счёт` : ""}
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
