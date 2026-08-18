import { type FormEvent, useState } from "react";

import { platformApi } from "./platform-api.js";

/**
 * Подключение клуба продавцом.
 *
 * Владельцу не приходится ничего регистрировать: ему передают адрес, почту и
 * пароль, а зал уже заведён. Пароль показывается один раз — записать его надо
 * сразу, хеш обратно не читается.
 */
export function PlatformTenantForm({ onCreated }: { onCreated: () => void }) {
  const [networkName, setNetworkName] = useState("");
  const [clubName, setClubName] = useState("");
  const [city, setCity] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(suggestPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi.createTenant({
        networkName: networkName.trim() || clubName.trim(),
        clubName: clubName.trim(),
        city: city.trim() || undefined,
        ownerName: ownerName.trim(),
        email: email.trim(),
        password,
      });
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      <label>
        Клуб
        <input value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Cyber Zone" />
      </label>

      <label>
        Сеть (пусто — как клуб)
        <input value={networkName} onChange={(e) => setNetworkName(e.target.value)} />
      </label>

      <label>
        Город
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Шымкент" />
      </label>

      <label>
        Владелец
        <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Асхат" />
      </label>

      <label>
        Почта владельца
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@club.kz" />
      </label>

      <label>
        Пароль владельца
        <input value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>

      <div className="notice">
        Пароль передайте владельцу и запишите: обратно он не читается. Клуб получит пробный период
        на две недели и заведённую зону — можно сразу заводить тарифы и ставить агента.
      </div>

      <button className="primary" type="submit" disabled={busy}>
        Подключить
      </button>
    </form>
  );
}

/** Годный пароль сразу: продавец не должен придумывать его на ходу. */
function suggestPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const values = crypto.getRandomValues(new Uint32Array(12));
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}
