import { type FormEvent, useEffect, useState } from "react";

import type { AgentClient, SignupConfirmed } from "./agent-client.js";
import { Qr } from "./QrCode.js";

type Step =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "qr"; code: string; link: string; clubPhone: string; expiresAt: number }
  | { kind: "details"; code: string; existingName: string | null };

/** Номер для подписи под QR: +7 701 123 45 67. */
function formatPhone(digits: string): string {
  const m = /^7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${digits}`;
}


/**
 * Регистрация нового гостя за игровым ПК.
 *
 * Гость сканирует QR камерой телефона, WhatsApp открывается с готовым
 * сообщением на номер клуба — остаётся нажать «Отправить». Номер отправителя
 * подставляет сам WhatsApp, поэтому он подтверждён, а ввод телефона с
 * клавиатуры вовсе не нужен.
 */
export function SignupScreen({
  client,
  onDone,
  onCancel,
}: {
  client: AgentClient;
  /** Аккаунт готов: экран входа сам входит с этим номером и PIN. */
  onDone: (phone: string, pin: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function begin(): Promise<void> {
    setStep({ kind: "loading" });
    setError(null);
    try {
      const result = await client.startSignup();
      setStep(
        result.ok
          ? {
              kind: "qr",
              code: result.code,
              link: result.link,
              clubPhone: result.clubPhone,
              expiresAt: new Date(result.expiresAt).getTime(),
            }
          : { kind: "error", reason: result.reason },
      );
    } catch (cause) {
      setStep({ kind: "error", reason: (cause as Error).message });
    }
  }

  useEffect(() => {
    void begin();
  }, []);

  // Ждём сообщения от гостя: сервер скажет, когда оно придёт.
  const waitingCode = step.kind === "qr" ? step.code : null;
  useEffect(() => {
    if (!waitingCode) return;
    return client.onSignupConfirmed((event: SignupConfirmed) => {
      if (event.code !== waitingCode) return;
      setStep({ kind: "details", code: event.code, existingName: event.existingName });
    });
  }, [client, waitingCode]);

  // Обратный отсчёт: просроченный QR честно говорит, что его надо обновить.
  useEffect(() => {
    if (step.kind !== "qr") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [step.kind]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (step.kind !== "details") return;
    setError(null);
    if (!/^\d{4}$/.test(pin)) {
      setError("PIN — четыре цифры");
      return;
    }
    if (pin !== pinAgain) {
      setError("PIN не совпал — введите ещё раз");
      return;
    }

    setBusy(true);
    try {
      const result = await client.completeSignup(step.code, nickname, pin);
      if (result.ok) onDone(result.phone, pin);
      else setError(result.reason);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "loading") {
    return (
      <div className="card">
        <h1>Регистрация</h1>
        <div className="note">Готовим QR-код…</div>
      </div>
    );
  }

  if (step.kind === "error") {
    return (
      <div className="card">
        <h1>Регистрация</h1>
        <div className="error">{step.reason}</div>
        <button className="ghost" onClick={onCancel}>
          Назад
        </button>
      </div>
    );
  }

  if (step.kind === "qr") {
    const left = Math.max(0, Math.round((step.expiresAt - now) / 1000));
    const expired = left === 0;
    return (
      <div className="card">
        <h1>Регистрация через WhatsApp</h1>

        {expired ? (
          <div className="banner warn">Код устарел — получите новый.</div>
        ) : (
          <>
            <Qr text={step.link} />
            <ol className="steps">
              <li>Наведите камеру телефона на QR-код</li>
              <li>Откроется WhatsApp с готовым сообщением — нажмите «Отправить»</li>
              <li>Этот экран продолжит регистрацию сам</li>
            </ol>
            {/* Без камеры гость может набрать сообщение вручную. */}
            <div className="note">
              Нет камеры? Напишите <b className="code">{step.code}</b> в WhatsApp на номер{" "}
              {formatPhone(step.clubPhone)}.
            </div>
            <div className="note">
              Ждём сообщение… {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </div>
          </>
        )}

        {expired && (
          <button className="primary" onClick={() => void begin()}>
            Новый QR-код
          </button>
        )}
        <button className="ghost" onClick={onCancel}>
          Отмена
        </button>
      </div>
    );
  }

  const existing = step.existingName;
  return (
    <form className="card" onSubmit={submit}>
      <h1>{existing ? `С возвращением, ${existing}` : "Номер подтверждён ✅"}</h1>

      {error && <div className="error">{error}</div>}

      {existing ? (
        <div className="note">У вас уже есть аккаунт. Придумайте новый PIN для входа.</div>
      ) : (
        <label>
          Ник или имя
          <input
            value={nickname}
            maxLength={24}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Shadow"
            autoFocus
          />
        </label>
      )}

      <label>
        Придумайте PIN
        <input
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="····"
          autoFocus={Boolean(existing)}
        />
      </label>

      <label>
        PIN ещё раз
        <input
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={pinAgain}
          onChange={(e) => setPinAgain(e.target.value.replace(/\D/g, ""))}
          placeholder="····"
        />
      </label>

      <button
        className="primary"
        type="submit"
        disabled={busy || pin.length !== 4 || pinAgain.length !== 4 || (!existing && nickname.trim().length < 2)}
      >
        {busy ? "Создаём…" : existing ? "Сохранить PIN и войти" : "Готово — войти"}
      </button>

      <div className="note">PIN нужен для входа на любом ПК клуба вместе с номером телефона.</div>
    </form>
  );
}
