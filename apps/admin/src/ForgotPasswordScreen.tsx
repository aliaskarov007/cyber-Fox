import { type FormEvent, useState } from "react";

import { api } from "./api.js";
import { AuthLogo, AuthShell, PasswordInput } from "./AuthShell.js";

/**
 * «Забыли пароль?»: код приходит на рабочую почту, а если указан WhatsApp — и туда.
 *
 * Шаг 1 — почта, шаг 2 — код и новый пароль. Ответ на шаге 1 одинаковый,
 * есть такой сотрудник или нет: экран не должен подсказывать, кто работает в клубе.
 */
export function ForgotPasswordScreen({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(email.trim());
      setStep("code");
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
      const result = await api.confirmPasswordReset({
        email: email.trim(),
        code: code.trim(),
        password,
      });
      if (result.ok) onDone();
      else setError(result.error);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      {step === "email" ? (
        <form className="fx-login-card" onSubmit={sendCode}>
          <AuthLogo />
          <h1 className="fx-login-title">Сброс пароля</h1>
          <p className="fx-signup-note">
            Введите почту, с которой входите. Мы пришлём на неё код для сброса
            пароля.
          </p>

          {error && <div className="error">{error}</div>}

          <label className="fx-field">
            Рабочая почта
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@club.kz"
              autoComplete="username"
              required
            />
          </label>

          <button className="fx-login-go" type="submit" disabled={busy}>
            {busy ? "Отправляем…" : "Получить код"}
          </button>

          <div className="fx-login-join">
            <button type="button" onClick={onBack}>
              Вернуться ко входу
            </button>
          </div>
        </form>
      ) : (
        <form className="fx-login-card" onSubmit={confirm}>
          <AuthLogo />
          <h1 className="fx-login-title">Новый пароль</h1>
          <p className="fx-signup-note">
            Если аккаунт {email.trim()} есть, код уже пришёл на эту почту.
            Проверьте и папку «Спам». Код действует 10 минут.
          </p>

          {error && <div className="error">{error}</div>}

          <label className="fx-field">
            Код из письма
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              required
            />
          </label>

          <label className="fx-field" htmlFor="fx-new-password">
            Новый пароль
          </label>
          <PasswordInput
            id="fx-new-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
          />

          <button
            className="fx-login-go"
            type="submit"
            disabled={busy || code.length !== 6 || password.length < 8}
          >
            {busy ? "Сохраняем…" : "Сохранить пароль"}
          </button>

          <button
            type="button"
            className="fx-forgot"
            onClick={() => void sendCode()}
            disabled={busy}
          >
            Отправить код ещё раз
          </button>

          <div className="fx-login-join">
            <button type="button" onClick={onBack}>
              Вернуться ко входу
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
