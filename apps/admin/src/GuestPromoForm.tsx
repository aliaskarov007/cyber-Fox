import { type FormEvent, useState } from "react";

import { type Club, api, formatMoney } from "./api.js";

/**
 * Ввод промокода за гостя на стойке. Гость может ввести код и сам за игровым
 * ПК — эта форма для тех, кто назвал его администратору.
 */
export function GuestPromoForm({
  club,
  guestId,
  onApplied,
}: {
  club: Club;
  guestId: string;
  onApplied: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await api.redeemPromo(club.id, guestId, code);
      setDone(
        result.kind === "BALANCE"
          ? `Код ${result.code}: на счёт зачислено ${formatMoney(result.amount)}.`
          : `Код ${result.code}: начислено ${formatMoney(result.amount)} бонусами.`,
      );
      setCode("");
      onApplied();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}
      {done && <div className="notice">{done}</div>}

      <label>
        Код
        <input
          value={code}
          maxLength={30}
          autoCapitalize="characters"
          placeholder="FOX500"
          onChange={(e) => setCode(e.target.value)}
        />
      </label>

      <button className="primary" type="submit" disabled={busy || code.trim().length < 4}>
        Применить
      </button>
    </form>
  );
}
