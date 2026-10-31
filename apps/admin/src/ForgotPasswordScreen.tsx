import { type FormEvent, useState } from "react";

import { api } from "./api.js";
import { AuthLogo, AuthShell, PasswordInput } from "./AuthShell.js";

/**
 * «Забыли пароль?»: сотрудник вводит свой номер, код приходит в WhatsApp.
 *
 * Шаг 1 — номер WhatsApp, шаг 2 — код и новый пароль. Ответ на шаге 1 одинаковый,
 * есть такой сотрудник или нет: экран не должен подсказывать, кто работает в клубе.
 */
export function ForgotPasswordScreen({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(phone.trim());
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
        phone: phone.trim(),
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
      {step === "phone" ? (
        <form className="fx-login-card" onSubmit={sendCode}>
          <AuthLogo />
          <h1 className="fx-login-title">Сброс пароля</h1>
          <p className="fx-signup-note">
            Введите свой номер WhatsApp. Код для сброса придёт на него, если
            номер указан в вашей карточке сотрудника.
          </p>

          {error && <div className="error">{error}</div>}

          <label className="fx-field">
            Номер WhatsApp
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 701 123 45 67"
              autoComplete="tel"
              required
            />
          </label>

          <button className="fx-login-go" type="submit" disabled={busy}>
            {busy ? "Отправляем…" : "Получить код в WhatsApp"}
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
            Если номер {phone.trim()} указан в карточке сотрудника, код уже
            пришёл в WhatsApp. Код действует 10 минут. Не пришёл — напишите в
            техподдержку.
          </p>

          {error && <div className="error">{error}</div>}

          <label className="fx-field">
            Код из WhatsApp
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
