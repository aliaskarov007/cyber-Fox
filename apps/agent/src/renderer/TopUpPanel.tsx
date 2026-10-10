import { useEffect, useState } from "react";

import { type AgentClient, type TopUpStart, formatMoney } from "./agent-client.js";
import { Qr } from "./QrCode.js";

/** Суммы в тенге, которые чаще всего пополняют на стойке. */
const PRESETS = [500, 1000, 2000, 5000];

type Step =
  | { kind: "amount" }
  | { kind: "loading" }
  | { kind: "qr"; payment: Extract<TopUpStart, { ok: true }> }
  | { kind: "paid"; amount: number };

/**
 * Пополнение счёта по единому QR с экрана игрового ПК.
 *
 * Гость выбирает сумму и сканирует QR камерой телефона — открывается его
 * банковское приложение. Если банк клуба подключён, QR уже с суммой и деньги
 * зачисляются сами; если нет, показывается статический QR клуба, а
 * поступление подтверждает касса. В обоих случаях экран ждёт зачисления и
 * закрывается сам.
 */
export function TopUpPanel({
  client,
  disabled,
  onPaid,
  onClose,
}: {
  client: AgentClient;
  disabled: boolean;
  onPaid: (amount: number) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "amount" });
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const waitingFor = step.kind === "qr" ? step.payment.intentId : null;

  useEffect(() => {
    if (!waitingFor) return;
    return client.onTopUpPaid((event) => {
      if (event.intentId !== waitingFor) return;
      setStep({ kind: "paid", amount: event.amount });
      onPaid(event.amount);
    });
  }, [client, waitingFor, onPaid]);

  async function start(tenge: number): Promise<void> {
    setError(null);
    setStep({ kind: "loading" });
    try {
      const result = await client.createTopUp(Math.round(tenge * 100));
      if (!result.ok) {
        setError(result.reason);
        setStep({ kind: "amount" });
        return;
      }
      setStep({ kind: "qr", payment: result });
    } catch {
      setError("Нет ответа от сервера. Попробуйте ещё раз.");
      setStep({ kind: "amount" });
    }
  }

  if (step.kind === "paid") {
    return (
      <div className="topup">
        <div className="banner info">Счёт пополнен на {formatMoney(step.amount)}. Спасибо!</div>
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    );
  }

  if (step.kind === "qr") {
    const { payment } = step;
    return (
      <div className="topup">
        <h2 className="topup-title">Пополнение на {formatMoney(payment.amount)}</h2>
        {payment.mode === "dynamic" && payment.qrPayload ? (
          <Qr text={payment.qrPayload} label="QR для оплаты" />
        ) : payment.qrImageUrl ? (
          <img className="qr" src={client.resolveUrl(payment.qrImageUrl)} alt="QR клуба для оплаты" />
        ) : null}
        <ol className="steps">
          <li>Откройте камеру или банковское приложение и наведите на QR.</li>
          {payment.mode === "static" ? (
            <>
              <li>
                Введите сумму <b>{formatMoney(payment.amount)}</b> — ровно столько, иначе касса не
                узнает ваш платёж.
              </li>
              <li>После оплаты администратор подтвердит поступление, и деньги появятся на счёте.</li>
            </>
          ) : (
            <li>Подтвердите оплату — деньги зачислятся сами через несколько секунд.</li>
          )}
        </ol>
        <div className="note">Ждём оплату… Экран обновится сам.</div>
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    );
  }

  const customTenge = Number(custom.replace(",", "."));

  return (
    <div className="topup">
      <h2 className="topup-title">Пополнить по QR</h2>
      {error && <div className="error">{error}</div>}
      <div className="topup-presets">
        {PRESETS.map((tenge) => (
          <button
            key={tenge}
            type="button"
            disabled={disabled || step.kind === "loading"}
            onClick={() => void start(tenge)}
          >
            {tenge.toLocaleString("ru-KZ")} ₸
          </button>
        ))}
      </div>
      <div className="promo-row">
        <input
          inputMode="numeric"
          value={custom}
          placeholder="Другая сумма, ₸"
          aria-label="Сумма пополнения в тенге"
          onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))}
        />
        <button
          className="primary"
          type="button"
          disabled={disabled || step.kind === "loading" || !(customTenge >= 100)}
          onClick={() => void start(customTenge)}
        >
          {step.kind === "loading" ? "Готовим QR…" : "Показать QR"}
        </button>
      </div>
      <button className="ghost" type="button" onClick={onClose}>
        Отмена
      </button>
    </div>
  );
}
