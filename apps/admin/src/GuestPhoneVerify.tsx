import { type FormEvent, useState } from "react";

import { type Club, type Guest, api } from "./api.js";

/**
 * Подтверждение номера гостя кодом из WhatsApp.
 *
 * Гость получает четыре цифры и называет их на стойке. Пока номер не
 * подтверждён, приглашения на ивенты ему не уходят: писать на номер, который
 * никто не проверял, — значит рисковать блокировкой номера клуба.
 */
export function GuestPhoneVerify({
  club,
  guest,
  onChanged,
}: {
  club: Club;
  guest: Guest;
  onChanged: () => void;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.sendPhoneCode(club.id, guest.id);
      setSentTo(result.sentTo);
      setCode("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!/^\d{4}$/.test(code)) throw new Error("Код — четыре цифры");
      const result = await api.confirmPhoneCode(club.id, guest.id, code);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSentTo(null);
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (guest.phoneVerified) {
    return (
      <div className="rows">
        <div className="row">
          <span className="k">WhatsApp</span>
          <span>подтверждён ✓</span>
        </div>
        <div className="row">
          <span className="k">Приглашения на ивенты</span>
          <span>{guest.invitesOptOut ? "отписался (СТОП)" : "получает"}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {error && <div className="error">{error}</div>}

      {sentTo === null ? (
        <>
          <div className="notice">
            Номер не подтверждён — приглашения на ивенты гостю не уходят. Отправьте код в WhatsApp
            и попросите гостя назвать его.
          </div>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void send()}>
              Отправить код в WhatsApp
            </button>
          </div>
        </>
      ) : (
        <form className="settings-grid" onSubmit={confirm}>
          <div className="notice">Код отправлен на +{sentTo}. Действует 10 минут.</div>
          <label>
            Код от гостя
            <input
              inputMode="numeric"
              autoFocus
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className="actions">
            <button className="primary" type="submit" disabled={busy}>
              Подтвердить
            </button>
            <button type="button" disabled={busy} onClick={() => void send()}>
              Отправить заново
            </button>
          </div>
        </form>
      )}
    </>
  );
}
