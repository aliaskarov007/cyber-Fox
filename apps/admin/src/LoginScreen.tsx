import { type FormEvent, useEffect, useState } from "react";

import { api, setToken } from "./api.js";
import { AuthLogo, AuthShell } from "./AuthShell.js";

/** Клуб, привязанный к этому ПК после первого входа — для быстрого входа по ПИН. */
const PIN_CLUB_KEY = "fx_pin_club";
function rememberedClub(): string | null {
  try {
    return localStorage.getItem(PIN_CLUB_KEY);
  } catch {
    return null;
  }
}
function rememberClub(clubId: string | null): void {
  try {
    if (clubId) localStorage.setItem(PIN_CLUB_KEY, clubId);
  } catch {
    // Приватный режим или заблокированное хранилище — быстрый вход просто не появится.
  }
}

export function LoginScreen({
  notice,
  onDone,
  onSignup,
  onForgot,
}: {
  notice?: string | null;
  onDone: () => void;
  onSignup: () => void;
  onForgot: () => void;
}) {
  const club = rememberedClub();
  const [mode, setMode] = useState<"pin" | "password">(
    club ? "pin" : "password",
  );

  if (mode === "pin" && club) {
    return (
      <PinLogin
        clubId={club}
        onDone={onDone}
        onPassword={() => setMode("password")}
      />
    );
  }

  return (
    <PasswordLogin
      notice={notice}
      onDone={onDone}
      onSignup={onSignup}
      onForgot={onForgot}
      onPin={club ? () => setMode("pin") : undefined}
    />
  );
}

function PasswordLogin({
  notice,
  onDone,
  onSignup,
  onForgot,
  onPin,
}: {
  notice?: string | null;
  onDone: () => void;
  onSignup: () => void;
  onForgot: () => void;
  onPin?: () => void;
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
      // Запоминаем клуб на этом ПК — чтобы кассиры могли входить по ПИН.
      rememberClub(result.staff?.clubId ?? null);
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const eyeLabel = showPassword ? "Скрыть пароль" : "Показать пароль";

  return (
    <AuthShell>
      <form className="fx-login-card" onSubmit={submit}>
        <AuthLogo />
        <h1 className="fx-login-title">Вход</h1>

        {notice && !error && <div className="fx-notice">{notice}</div>}
        {error && <div className="error">{error}</div>}

        {onPin && (
          <button type="button" className="fx-forgot" onClick={onPin}>
            ← Быстрый вход по ПИН
          </button>
        )}

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
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3l18 18" />
                <path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <button type="button" className="fx-forgot" onClick={onForgot}>
          Забыли пароль?
        </button>

        <button className="fx-login-go" type="submit" disabled={busy}>
          {busy ? "Проверяем…" : "Войти"}
        </button>

        <div className="fx-login-join">
          <button type="button" onClick={onSignup}>
            Подключить клуб
          </button>
          <small>Первые 2 недели — БЕСПЛАТНО</small>
        </div>
      </form>
    </AuthShell>
  );
}

/** Быстрый вход кассира: список кассиров клуба → имя → 4 цифры ПИН. */
function PinLogin({
  clubId,
  onDone,
  onPassword,
}: {
  clubId: string;
  onDone: () => void;
  onPassword: () => void;
}) {
  const [cashiers, setCashiers] = useState<
    Array<{ id: string; fullName: string }>
  >([]);
  const [selected, setSelected] = useState<{
    id: string;
    fullName: string;
  } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .cashiers(clubId)
      .then((list) => {
        if (alive) setCashiers(list);
      })
      .catch(() => {
        // Клуб недоступен — остаёмся без списка, можно войти по паролю.
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [clubId]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selected || pin.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.pinLogin(selected.id, pin);
      setToken(result.accessToken);
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="fx-login-card">
        <AuthLogo />
        <h1 className="fx-login-title">Быстрый вход</h1>

        {error && <div className="error">{error}</div>}

        {loaded && cashiers.length === 0 && (
          <div className="fx-notice">
            Ни у кого ещё не задан ПИН. Войдите по паролю и задайте ПИН в шапке.
          </div>
        )}

        {!selected ? (
          <div className="pin-cashiers">
            {cashiers.map((c) => (
              <button
                key={c.id}
                type="button"
                className="pin-cashier"
                onClick={() => {
                  setSelected(c);
                  setPin("");
                  setError(null);
                }}
              >
                {c.fullName}
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="pin-who">{selected.fullName}</div>
            <input
              className="pin-input"
              inputMode="numeric"
              autoFocus
              maxLength={4}
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="● ● ● ●"
              aria-label="ПИН"
            />
            <button
              className="fx-login-go"
              type="submit"
              disabled={busy || pin.length !== 4}
            >
              {busy ? "Входим…" : "Войти"}
            </button>
            <button
              type="button"
              className="fx-forgot"
              onClick={() => {
                setSelected(null);
                setPin("");
                setError(null);
              }}
            >
              ← Другой кассир
            </button>
          </form>
        )}

        <button type="button" className="fx-forgot" onClick={onPassword}>
          Вход по паролю
        </button>
      </div>
    </AuthShell>
  );
}
