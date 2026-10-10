import { type FormEvent, useState } from "react";

import { type AgentClient, type PromoRedeem, formatMoney } from "./agent-client.js";

/**
 * Ввод промокода гостем. Свёрнут в одну кнопку: код есть у немногих, и поле
 * на виду у всех заставляет остальных думать, что они что-то упускают.
 *
 * Кому зачислить, решает сервер — по сессии этой машины или по только что
 * выполненному входу; экран номер гостя не передаёт.
 */
export function PromoField({
  client,
  disabled,
  startOpen = false,
  onClose,
  onApplied,
}: {
  client: AgentClient;
  /** Без связи код проверить некому. */
  disabled: boolean;
  /** Поле уже раскрыто: кнопку показали снаружи, как в полосе сессии. */
  startOpen?: boolean;
  onClose?: () => void;
  onApplied: (result: Extract<PromoRedeem, { ok: true }>) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await client.redeemPromo(code);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setDone(
        result.kind === "BALANCE"
          ? `Готово: на счёт зачислено ${formatMoney(result.amount)}`
          : `Готово: начислено ${formatMoney(result.amount)} бонусами`,
      );
      setCode("");
      setOpen(false);
      onApplied(result);
      onClose?.();
    } catch {
      setError("Нет ответа от сервера. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        {done && <div className="banner info">{done}</div>}
        <button
          className="ghost"
          type="button"
          disabled={disabled}
          onClick={() => {
            setDone(null);
            setOpen(true);
          }}
        >
          У меня есть промокод
        </button>
      </>
    );
  }

  return (
    <form className="promo-field" onSubmit={submit}>
      {error && <div className="error">{error}</div>}
      <div className="promo-row">
        <input
          value={code}
          maxLength={30}
          autoFocus
          placeholder="Промокод"
          aria-label="Промокод"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="primary" type="submit" disabled={busy || disabled || code.trim().length < 4}>
          {busy ? "Проверяем…" : "Применить"}
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setCode("");
            onClose?.();
          }}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
