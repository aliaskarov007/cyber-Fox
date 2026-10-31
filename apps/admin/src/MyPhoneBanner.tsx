import { type FormEvent, useState } from "react";

import { api } from "./api.js";

/**
 * Просьба указать свой WhatsApp сразу после входа.
 *
 * На этот номер приходит код, если сотрудник забудет пароль. Искать поле в
 * настройках никто не станет — поэтому полоса висит сверху, пока номера нет.
 */
export function MyPhoneBanner({
  onSaved,
}: {
  onSaved: (phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.setMyPhone(phone.trim());
      onSaved(result.phone);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="phone-banner" onSubmit={save}>
      <span>
        <b>Укажите свой WhatsApp</b> — на него придёт код, если вы забудете
        пароль.
      </span>
      <input
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+7 701 123 45 67"
        autoComplete="tel"
        required
      />
      <button
        className="primary"
        type="submit"
        disabled={busy || phone.trim().length < 10}
      >
        {busy ? "Сохраняем…" : "Сохранить"}
      </button>
      {error && <span className="phone-banner-error">{error}</span>}
    </form>
  );
}
