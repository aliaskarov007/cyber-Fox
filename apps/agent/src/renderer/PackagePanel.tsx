import { useEffect, useState } from "react";

import {
  type AgentClient,
  type BuyablePackage,
  formatMoney,
} from "./agent-client.js";

/**
 * Покупка пакета гостем во время сессии — с баланса, из действующих пакетов
 * своей зоны. Новые минуты подхватит сервер, шапка обновится сама.
 */
export function PackagePanel({
  client,
  disabled,
  onBought,
  onClose,
}: {
  client: AgentClient;
  disabled: boolean;
  onBought: (name: string) => void;
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<BuyablePackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function buy(pkg: BuyablePackage): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.buyPackage(pkg.id);
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

      {packages.length === 0 ? (
        <p className="net-hint">В этой зоне нет пакетов для покупки.</p>
      ) : (
        packages.map((p) => (
          <button
            key={p.id}
            className="pkg-option"
            disabled={disabled || busy || !p.affordable}
            onClick={() => void buy(p)}
          >
            <span className="pkg-name">{p.name}</span>
            <span className="pkg-meta">
              {p.minutes} мин · {formatMoney(p.price)}
              {!p.affordable ? " · не хватает на балансе" : ""}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
