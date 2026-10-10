import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  type Club,
  type Promo,
  type PromoKind,
  type PromoRedemption,
  type Staff,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

const KIND_LABEL: Record<PromoKind, string> = {
  BALANCE: "Деньги на счёт",
  BONUS: "Бонусы",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-KZ", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function promoStatus(promo: Promo): { label: string; chip: string } {
  if (promo.disabledAt) return { label: "отключён", chip: "offline" };
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= Date.now()) {
    return { label: "истёк", chip: "offline" };
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return { label: "разобран", chip: "offline" };
  }
  return { label: "действует", chip: "in-use" };
}

/**
 * Промокоды: деньги на счёт или бонусы. Гость вводит код сам за игровым ПК
 * или называет администратору — каждый гость один раз.
 *
 * Деньги по коду не проходят через кассу: сверка смены их не ждёт.
 */
export function PromosScreen({ club, staff }: { club: Club; staff: Staff }) {
  const canManage = staff.role === "OWNER" || staff.role === "ADMIN";
  const [promos, setPromos] = useState<Promo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPromos(await api.promos(club.id));
  }, [club.id]);

  useEffect(() => {
    setOpenId(null);
    void load();
  }, [load]);

  async function disable(promo: Promo): Promise<void> {
    if (!window.confirm(`Отключить код ${promo.code}? Уже начисленное останется у гостей.`)) return;
    setError(null);
    try {
      await api.disablePromo(club.id, promo.id);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <main>
      {error && <div className="error">{error}</div>}

      {canManage && (
        <PromoForm club={club} isOwner={staff.role === "OWNER"} onCreated={() => void load()} />
      )}

      <section className="zone-block">
        <div className="zone-head">
          <h2>Промокоды</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Что даёт</th>
                <th>Где</th>
                <th>Использован</th>
                <th>До</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => {
                const status = promoStatus(promo);
                return (
                  <tr key={promo.id} style={status.chip === "offline" ? { opacity: 0.6 } : undefined}>
                    <td className="num">
                      <strong>{promo.code}</strong>
                      {promo.comment && (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{promo.comment}</div>
                      )}
                    </td>
                    <td>
                      {formatMoney(promo.amount)} · {KIND_LABEL[promo.kind].toLowerCase()}
                    </td>
                    <td>{promo.clubId === null ? "вся сеть" : (promo.clubName ?? "этот зал")}</td>
                    <td className="num">
                      {promo.usedCount}
                      {promo.maxUses !== null ? ` из ${promo.maxUses}` : ""}
                    </td>
                    <td>{promo.expiresAt ? formatDate(promo.expiresAt) : "без срока"}</td>
                    <td>
                      <span className={`chip ${status.chip}`}>{status.label}</span>
                    </td>
                    <td>
                      <div className="actions">
                        <button
                          disabled={promo.usedCount === 0}
                          onClick={() => setOpenId(openId === promo.id ? null : promo.id)}
                        >
                          {openId === promo.id ? "Скрыть" : "Кто ввёл"}
                        </button>
                        {canManage &&
                          !promo.disabledAt &&
                          (promo.clubId !== null || staff.role === "OWNER") && (
                            <button onClick={() => void disable(promo)}>Отключить</button>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {promos.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    Промокодов пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {openId && <RedemptionList club={club} promoId={openId} />}
    </main>
  );
}

function PromoForm({
  club,
  isOwner,
  onCreated,
}: {
  club: Club;
  isOwner: boolean;
  onCreated: () => void;
}) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<PromoKind>("BALANCE");
  const [amount, setAmount] = useState("500");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [networkWide, setNetworkWide] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Promo | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const tiyn = toTiyn(amount);
      if (!Number.isFinite(tiyn) || tiyn < 100) throw new Error("Сумма — от 1 ₸");
      const uses = maxUses.trim() ? Number(maxUses) : undefined;
      if (uses !== undefined && (!Number.isInteger(uses) || uses < 1)) {
        throw new Error("Число гостей — целое, от одного");
      }
      const promo = await api.createPromo(club.id, {
        kind,
        amount: tiyn,
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(uses !== undefined ? { maxUses: uses } : {}),
        // Поле datetime-local даёт время без пояса — браузер стойки стоит в поясе зала.
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(networkWide ? { networkWide: true } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setCreated(promo);
      setCode("");
      setComment("");
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Новый промокод</h2>
      </div>
      {error && <div className="error">{error}</div>}
      {created && (
        <div className="notice">
          Код <strong>{created.code}</strong> заведён: {formatMoney(created.amount)}{" "}
          {created.kind === "BALANCE" ? "на счёт" : "бонусами"}. Гость вводит его за игровым ПК
          после входа или называет на стойке.
        </div>
      )}
      <form className="settings-grid" onSubmit={submit}>
        <label>
          Код
          <input
            value={code}
            maxLength={20}
            autoCapitalize="characters"
            placeholder="пусто — придумаем сами"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label>
          Что даёт
          <select value={kind} onChange={(e) => setKind(e.target.value as PromoKind)}>
            <option value="BALANCE">{KIND_LABEL.BALANCE}</option>
            <option value="BONUS">{KIND_LABEL.BONUS}</option>
          </select>
        </label>
        <label>
          {kind === "BALANCE" ? "Сумма, ₸" : "Бонусов, ₸"}
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Сколько гостей (пусто — без ограничения)
          <input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </label>
        <label>
          Действует до
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
        {isOwner && (
          <label>
            Где действует
            <select
              value={networkWide ? "network" : "club"}
              onChange={(e) => setNetworkWide(e.target.value === "network")}
            >
              <option value="club">Только в «{club.name}»</option>
              <option value="network">Во всех залах сети</option>
            </select>
          </label>
        )}
        <label className="wide">
          Заметка для себя
          <input
            value={comment}
            maxLength={200}
            placeholder="Листовки у колледжа, октябрь"
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Создать
        </button>
      </form>
    </section>
  );
}

function RedemptionList({ club, promoId }: { club: Club; promoId: string }) {
  const [list, setList] = useState<PromoRedemption[] | null>(null);

  useEffect(() => {
    setList(null);
    void api.promoRedemptions(club.id, promoId).then(setList);
  }, [club.id, promoId]);

  if (!list) return <div className="notice">Загружаем…</div>;

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Кто ввёл код</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Когда</th>
              <th>Гость</th>
              <th>Телефон</th>
              <th>Где ввёл</th>
              <th>Начислено</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.createdAt)}</td>
                <td>{r.guest.fullName}</td>
                <td className="num">{r.guest.phone}</td>
                <td>{r.atComputer ? "сам за ПК" : "на стойке"}</td>
                <td className="num">{formatMoney(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
