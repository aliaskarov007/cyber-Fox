import { useEffect, useState } from "react";

import { type AgentClient, type TopUpStart, formatMoney } from "./agent-client.js";
import { Qr } from "./QrCode.js";
import { useConfirm } from "./Confirm.js";

/** Суммы в тенге, которые чаще всего пополняют на стойке. */
const PRESETS = [500, 1000, 2000, 5000];

type Method = "qr" | "phone";

type Step =
  | { kind: "amount" }
  | { kind: "loading" }
  | { kind: "waiting"; payment: Extract<TopUpStart, { ok: true }> }
  | { kind: "paid"; amount: number };

/**
 * Пополнение счёта с экрана игрового ПК.
 *
 * Kaspi подключён — счёт выставляется под этот платёж: QR на сумму или push в
 * приложение Kaspi на номер гостя, и деньги зачисляются сами. Не подключён —
 * статический QR клуба, гость вводит сумму сам, поступление подтверждает касса.
 * В обоих случаях экран ждёт зачисления и закрывается сам.
 *
 * Kaspi «Платежи» (сеть подключена к Kaspi напрямую) — первым показываем QR со
 * ссылкой на услугу клуба и номером гостя: камера телефона открывает Kaspi,
 * гость вводит сумму, деньги зачисляются сами.
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
  const [kaspi, setKaspi] = useState(false);
  const [method, setMethod] = useState<Method>("phone");
  const [kaspiLink, setKaspiLink] = useState<string | null>(null);
  /** Гость ушёл с QR Kaspi «Платежи» на прежние способы. */
  const [otherWays, setOtherWays] = useState(false);
  const [hasOtherWays, setHasOtherWays] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    void client
      .topUpOptions()
      .then((options) => {
        setKaspi(options.kaspi);
        setKaspiLink(options.kaspiLink ?? null);
        setHasOtherWays(options.kaspi || options.staticQr);
      })
      .catch(() => setKaspi(false));
  }, [client]);

  const showKaspiLink = kaspiLink !== null && !otherWays && step.kind === "amount";

  // QR Kaspi «Платежи»: платёж не привязан к счёту на экране — ждём любое зачисление этому гостю.
  useEffect(() => {
    if (!showKaspiLink) return;
    return client.onTopUpPaid((event) => {
      setStep({ kind: "paid", amount: event.amount });
      onPaid(event.amount);
    });
  }, [client, showKaspiLink, onPaid]);

  const waitingFor = step.kind === "waiting" ? step.payment.intentId : null;

  useEffect(() => {
    if (!waitingFor) return;
    const offPaid = client.onTopUpPaid((event) => {
      if (event.intentId !== waitingFor) return;
      setStep({ kind: "paid", amount: event.amount });
      onPaid(event.amount);
    });
    const offFailed = client.onTopUpFailed((event) => {
      if (event.intentId !== waitingFor) return;
      setError(`${event.reason}. Попробуйте ещё раз.`);
      setStep({ kind: "amount" });
    });
    return () => {
      offPaid();
      offFailed();
    };
  }, [client, waitingFor, onPaid]);

  async function start(tenge: number): Promise<void> {
    if (!(await confirm(`Пополнить счёт на ${formatMoney(Math.round(tenge * 100))}?`)))
      return;
    setError(null);
    setStep({ kind: "loading" });
    try {
      const result = await client.createTopUp(Math.round(tenge * 100), kaspi ? method : "qr");
      if (!result.ok) {
        setError(result.reason);
        setStep({ kind: "amount" });
        return;
      }
      setStep({ kind: "waiting", payment: result });
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

  if (step.kind === "waiting") {
    const { payment } = step;
    return (
      <div className="topup">
        <h2 className="topup-title">Пополнение на {formatMoney(payment.amount)}</h2>

        {payment.mode === "kaspi_phone" ? (
          <ol className="steps">
            <li>
              Счёт отправлен в Kaspi на номер <b>{payment.phoneMasked}</b>.
            </li>
            <li>Откройте приложение Kaspi на телефоне — счёт будет в уведомлениях и в разделе «Платежи».</li>
            <li>Подтвердите оплату — деньги зачислятся сами через несколько секунд.</li>
          </ol>
        ) : (
          <>
            {payment.qrImageUrl ? (
              <img
                className="qr"
                src={client.resolveUrl(payment.qrImageUrl)}
                alt="QR для оплаты"
              />
            ) : payment.qrPayload ? (
              <Qr text={payment.qrPayload} label="QR для оплаты" />
            ) : null}
            <ol className="steps">
              <li>Откройте камеру или приложение Kaspi и наведите на QR.</li>
              {payment.mode === "static" ? (
                <>
                  <li>
                    Введите сумму <b>{formatMoney(payment.amount)}</b> — ровно столько, иначе касса не
                    узнает ваш платёж.
                  </li>
                  <li>После оплаты администратор подтвердит поступление, и деньги появятся на счёте.</li>
                </>
              ) : (
                <li>Сумма уже в счёте — подтвердите оплату, и деньги зачислятся сами.</li>
              )}
            </ol>
          </>
        )}

        <div className="note">Ждём оплату… Экран обновится сам.</div>
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    );
  }

  if (showKaspiLink && kaspiLink) {
    return (
      <div className="topup">
        <h2 className="topup-title">Пополнить через Kaspi</h2>
        <Qr text={kaspiLink} label="QR для оплаты в Kaspi" />
        <ol className="steps">
          <li>Наведите камеру телефона на QR — откроется Kaspi с вашим номером.</li>
          <li>Введите сумму и подтвердите оплату.</li>
          <li>Деньги зачислятся на счёт сами через несколько секунд.</li>
        </ol>
        <div className="note">Ждём оплату… Экран обновится сам.</div>
        {hasOtherWays && (
          <button type="button" onClick={() => setOtherWays(true)}>
            Другой способ
          </button>
        )}
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    );
  }

  const customTenge = Number(custom.replace(",", "."));
  const busy = disabled || step.kind === "loading";

  return (
    <div className="topup">
      <h2 className="topup-title">{kaspi ? "Пополнить через Kaspi" : "Пополнить по QR"}</h2>
      {error && <div className="error">{error}</div>}

      {/* Номер гостя подтверждён — счёт на него удобнее QR: ничего сканировать не нужно. */}
      {kaspi && (
        <div className="topup-methods" role="radiogroup" aria-label="Способ оплаты">
          <button
            type="button"
            role="radio"
            aria-checked={method === "phone"}
            className={method === "phone" ? "primary" : ""}
            onClick={() => setMethod("phone")}
          >
            Счёт на мой номер в Kaspi
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={method === "qr"}
            className={method === "qr" ? "primary" : ""}
            onClick={() => setMethod("qr")}
          >
            QR-код
          </button>
        </div>
      )}

      <div className="topup-presets">
        {PRESETS.map((tenge) => (
          <button key={tenge} type="button" disabled={busy} onClick={() => void start(tenge)}>
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
          disabled={busy || !(customTenge >= 100)}
          onClick={() => void start(customTenge)}
        >
          {step.kind === "loading" ? "Готовим счёт…" : kaspi && method === "phone" ? "Отправить счёт" : "Показать QR"}
        </button>
      </div>
      <button className="ghost" type="button" onClick={onClose}>
        Отмена
      </button>
    </div>
  );
}
