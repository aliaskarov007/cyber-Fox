import { type FormEvent, useState } from "react";

import { api, setToken } from "./api.js";

export function LoginScreen({
  onDone,
  onSignup,
}: {
  onDone: () => void;
  onSignup: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(email, password);
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
      <form className="login-card" onSubmit={submit}>
        <h1 className="brand">
          Cyber-<span>Fox</span>
        </h1>

        {error && <div className="error">{error}</div>}

        <label>
          Рабочая почта
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Проверяем…" : "Войти"}
        </button>

        <button type="button" className="link-back" onClick={onSignup}>
          Подключить свой клуб — две недели бесплатно
        </button>
      </form>
    </div>
  );
}
