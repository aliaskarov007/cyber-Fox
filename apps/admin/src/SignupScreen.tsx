import { type FormEvent, useState } from "react";

import { api, setToken, toTiyn } from "./api.js";

/**
 * Регистрация чужого клуба.
 *
 * Полей ровно столько, сколько нужно, чтобы зал заработал: остальное владелец
 * донастроит внутри. Число машин и цена минуты спрашиваются здесь потому, что
 * без них система создаст пустую оболочку, в которой нельзя открыть сессию.
 */
export function SignupScreen({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [form, setForm] = useState({
    clubName: "",
    city: "",
    ownerName: "",
    email: "",
    password: "",
    computers: "20",
    pricePerMinute: "10",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.signup({
        clubName: form.clubName.trim(),
        city: form.city.trim() || undefined,
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        password: form.password,
        computers: Number(form.computers) || 0,
        pricePerMinute: toTiyn(form.pricePerMinute),
      });
      setToken(result.accessToken);
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" style={{ maxWidth: 460 }} onSubmit={submit}>
        <h1 className="brand">
          Cyber-<span>Fox</span>
        </h1>
        <div className="note">
          Две недели бесплатно. Карта не нужна — тариф выбирается позже.
        </div>

        {error && <div className="error">{error}</div>}

        <label>
          Название клуба
          <input
            value={form.clubName}
            onChange={(e) => set("clubName")(e.target.value)}
            required
            minLength={2}
          />
        </label>

        <label>
          Город
          <input value={form.city} onChange={(e) => set("city")(e.target.value)} />
        </label>

        <div className="settings-grid" style={{ padding: 0, background: "none", border: "none" }}>
          <label>
            Машин в зале
            <input
              inputMode="numeric"
              value={form.computers}
              onChange={(e) => set("computers")(e.target.value)}
            />
          </label>
          <label>
            Цена минуты, ₸
            <input
              inputMode="decimal"
              value={form.pricePerMinute}
              onChange={(e) => set("pricePerMinute")(e.target.value)}
            />
          </label>
        </div>

        <label>
          Ваше имя
          <input
            value={form.ownerName}
            onChange={(e) => set("ownerName")(e.target.value)}
            required
            minLength={2}
          />
        </label>

        <label>
          Рабочая почта
          <input
            type="email"
            value={form.email}
            onChange={(e) => set("email")(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Пароль
          <input
            type="password"
            value={form.password}
            onChange={(e) => set("password")(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Создаём клуб…" : "Начать бесплатно"}
        </button>

        <button type="button" className="link-back" onClick={onBack}>
          У меня уже есть аккаунт
        </button>
      </form>
    </div>
  );
}
