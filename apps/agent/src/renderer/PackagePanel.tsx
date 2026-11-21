import { useEffect, useState } from "react";

import {
  type AgentClient,
  type BuyablePackage,
  formatMoney,
} from "./agent-client.js";
import { useConfirm } from "./Confirm.js";

/**
 * Покупка пакета гостем во время сессии — с баланса, из действующих пакетов
 * своей зоны. Новые минуты подхватит сервер, шапка обновится сама.
 */
export function PackagePanel({
  client,
  disabled,
  bonusAvailable,
  onBought,
  onClose,
}: {
  client: AgentClient;
  disabled: boolean;
  /** Бонусов на счёте гостя, в тиын. Можно оплатить ими часть пакета. */
  bonusAvailable: number;
  onBought: (name: string) => void;
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<BuyablePackage[]>([]);
  const [useBonus, setUseBonus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  function refresh(): void {
    void client
      .packageOptions()
      .then((r) => setPackages(r.packages))
      .catch(() => setError("Не удалось загрузить пакеты"));
  }

  useEffect(() => {
    void client
      .packageOptions()
      .then((r) => setPackages(r.packages))
      .catch(() => setError("Не удалось загрузить пакеты"));
  }, [client]);

  function bonusFor(pkg: BuyablePackage): number {
    return useBonus ? Math.min(bonusAvailable, pkg.price) : 0;
  }

  async function buy(pkg: BuyablePackage): Promise<void> {
    if (busy) return;
    const bonus = bonusFor(pkg);
    const fromBalance = pkg.price - bonus;
    const how =
      bonus > 0
        ? `${formatMoney(bonus)} бонусами и ${formatMoney(fromBalance)} с баланса`
        : `${formatMoney(pkg.price)} с баланса`;
    if (!(await confirm(`Купить пакет «${pkg.name}» за ${how}?`))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.buyPackage(pkg.id, bonus);
      if (result.ok) {
        onBought(pkg.name);
        refresh();
      } else {
        setError(result.reason ?? "Не удалось купить пакет");
      }
    } catch {
      setError("Не удалось купить пакет");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pkg-buy">
      <div className="net-head">
        <b>Купить пакет</b>
        <button className="ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>

      {error && <div className="banner debt">{error}</div>}

      {bonusAvailable > 0 && (
        <label className="pkg-bonus">
          <input
            type="checkbox"
            checked={useBonus}
            onChange={(e) => setUseBonus(e.target.checked)}
          />
          Списать бонусы ({formatMoney(bonusAvailable)}) — остальное с баланса
        </label>
      )}

      {packages.length === 0 ? (
        <p className="net-hint">В этой зоне нет пакетов для покупки.</p>
      ) : (
        packages.map((p) => {
          const bonus = bonusFor(p);
          const fromBalance = p.price - bonus;
          return (
            <button
              key={p.id}
              className="pkg-option"
              disabled={disabled || busy || !p.affordable}
              onClick={() => void buy(p)}
            >
              <span className="pkg-name">{p.name}</span>
              <span className="pkg-meta">
                {p.minutes} мин · {formatMoney(p.price)}
                {bonus > 0
                  ? ` · бонусами ${formatMoney(bonus)} + с баланса ${formatMoney(fromBalance)}`
                  : ""}
                {!p.affordable ? " · не хватает средств" : ""}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
