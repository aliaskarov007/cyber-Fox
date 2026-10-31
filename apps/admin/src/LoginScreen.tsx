import { type FormEvent, useState } from "react";

import { api, setToken } from "./api.js";

const SUPPORT_PHONE = "+7 708 777 77 69";
const SUPPORT_PHONE_RAW = "77087777769";
const SUPPORT_EMAIL = "aliaskarovnye@gmail.com";

export function LoginScreen({
  onDone,
  onSignup,
}: {
  onDone: () => void;
  onSignup: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const eyeLabel = showPassword ? "Скрыть пароль" : "Показать пароль";

  return (
    <div className="fx-login">
      {/* Крупные надписи на фоне — только украшение, читалкам экрана не нужны. */}
      <div className="fx-login-bg" aria-hidden="true">
        <span className="w1">CYBERFOX</span>
        <span className="w2">CYBERFOX</span>
        <span className="w3">CYBERFOX</span>
        <span className="w4">CYBERFOX</span>
      </div>

      <main className="fx-login-main">
        <form className="fx-login-card" onSubmit={submit}>
          <div className="fx-login-logo">
            CYBER<span>FOX</span>
          </div>
          <h1 className="fx-login-title">Вход</h1>

          {error && <div className="error">{error}</div>}

          <label className="fx-field">
            Логин
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@club.kz"
              autoComplete="username"
              required
            />
          </label>

          <label className="fx-field" htmlFor="fx-password">
            Пароль
          </label>
          <div className="fx-password">
            <input
              id="fx-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="fx-eye"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={eyeLabel}
              title={eyeLabel}
            >
              {showPassword ? (
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                </svg>
              ) : (
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <button className="fx-login-go" type="submit" disabled={busy}>
            {busy ? "Проверяем…" : "Войти"}
          </button>

          <div className="fx-login-join">
            <button type="button" onClick={onSignup}>
              Подключить клуб
            </button>
            <small>ПЕРВЫЕ 2 НЕДЕЛИ — БЕСПЛАТНО</small>
          </div>
        </form>
      </main>

      <footer className="fx-login-footer">
        <section className="fx-support" aria-label="Техподдержка">
          <p className="fx-support-head">Техподдержка 24/7</p>
          <p>
            <a href={`tel:+${SUPPORT_PHONE_RAW}`}>{SUPPORT_PHONE}</a>
            <span className="fx-sep" aria-hidden="true">
              ·
            </span>
            <a href={`https://wa.me/${SUPPORT_PHONE_RAW}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </p>
          <p>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </section>
      </footer>
    </div>
  );
}
