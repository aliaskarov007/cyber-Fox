import { type FormEvent, useState } from "react";

import { api, setToken } from "./api.js";
import { AuthLogo, AuthShell } from "./AuthShell.js";

/**
 * Регистрация чужого клуба.
 *
 * Полей ровно столько, сколько нужно, чтобы зал заработал: остальное владелец
 * донастроит внутри. Число компьютеров спрашивается здесь, чтобы зал сразу
 * появился на карте. Цену минуты владелец ставит потом в тарифах — до этого
 * действует заготовка сервера.
 */
export function SignupScreen({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState({
    clubName: "",
    city: "",
    ownerName: "",
    email: "",
    password: "",
    computers: "20",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm({ ...form, [key]: value });

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
    <AuthShell>
      <form className="fx-login-card fx-signup-card" onSubmit={submit}>
        <AuthLogo />
        <h1 className="fx-login-title">Подключение клуба</h1>
        <p className="fx-signup-note">
          Первые 2 недели — БЕСПЛАТНО. Карта не нужна, тариф выбирается позже.
        </p>

        {error && <div className="error">{error}</div>}

        <label className="fx-field">
          Название клуба
          <input
            value={form.clubName}
            onChange={(e) => set("clubName")(e.target.value)}
            required
            minLength={2}
          />
        </label>

        <div className="fx-row">
          <label className="fx-field">
            Город
            <input
              value={form.city}
              onChange={(e) => set("city")(e.target.value)}
            />
          </label>
          <label className="fx-field">
            Количество компьютеров
            <input
              inputMode="numeric"
              value={form.computers}
              onChange={(e) => set("computers")(e.target.value)}
            />
          </label>
        </div>

        <div className="fx-row">
          <label className="fx-field">
            Ваше имя
            <input
              value={form.ownerName}
              onChange={(e) => set("ownerName")(e.target.value)}
              required
              minLength={2}
            />
          </label>
          <label className="fx-field">
            Рабочая почта
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email")(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
        </div>

        <label className="fx-field">
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

        <button className="fx-login-go" type="submit" disabled={busy}>
          {busy ? "Создаём клуб…" : "Начать бесплатно"}
        </button>

        <div className="fx-login-join">
          <button type="button" onClick={onBack}>
            У меня уже есть аккаунт
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
