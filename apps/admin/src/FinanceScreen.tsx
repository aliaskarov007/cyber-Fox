import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  type Club,
  type Expense,
  type Pnl,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

const PERIODS = [
  { days: 7, label: "7 дней" },
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
];

const CATEGORY_LABEL: Record<string, string> = {
  RENT: "Аренда",
  SALARY: "Зарплаты",
  UTILITIES: "Коммуналка",
  PURCHASE: "Закупки",
  MARKETING: "Реклама",
  REPAIR: "Ремонт",
  OTHER: "Прочее",
};

function todayKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/**
 * «Финансы» — прибыль клуба за период и журнал расходов. P&L: выручка минус
 * себестоимость бара даёт валовую прибыль, минус расходы по статьям — чистую.
 */
export function FinanceScreen({ club }: { club: Club }) {
  const [days, setDays] = useState(30);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const [p, ex] = await Promise.all([
      api.pnl(club.id, days),
      api.expenses(club.id, from, to),
    ]);
    setPnl(p);
    setExpenses(ex);
  }, [club.id, days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      await api.deleteExpense(club.id, id);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <main>
      <div className="an-head">
        <h2>Финансы</h2>
        <div className="seg">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              className={days === p.days ? "on" : ""}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {pnl && (
        <section className="an-card">
          <div className="an-title">Прибыль за период (P&L)</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Выручка — игровое время</span>
              <span>{formatMoney(pnl.timeRevenue)}</span>
            </div>
            <div className="row">
              <span className="k">Выручка — бар</span>
              <span>{formatMoney(pnl.barRevenue)}</span>
            </div>
            <div className="row">
              <span className="k">− Себестоимость бара</span>
              <span>{formatMoney(pnl.barCost)}</span>
            </div>
            <div className="row dash-total">
              <span className="k">Валовая прибыль</span>
              <b>{formatMoney(pnl.grossProfit)}</b>
            </div>
            {pnl.expenses.map((e) => (
              <div className="row" key={e.category}>
                <span className="k">− {CATEGORY_LABEL[e.category]}</span>
                <span>{formatMoney(e.amount)}</span>
              </div>
            ))}
            <div className="row">
              <span className="k">− Расходы всего</span>
              <span>{formatMoney(pnl.expensesTotal)}</span>
            </div>
            <div className="row dash-total">
              <span className="k">Чистая прибыль</span>
              <b
                style={{
                  color:
                    pnl.netProfit < 0 ? "var(--danger, #e5484d)" : undefined,
                }}
              >
                {formatMoney(pnl.netProfit)}
              </b>
            </div>
          </div>
          <div className="dash-hint">
            Пополнения балансов в выручку не входят — это предоплата. Расходы из
            кассы в смене и расходы здесь — разные журналы: сюда заносите всё
            для прибыли (аренда, зарплаты, коммуналка, закупки).
          </div>
        </section>
      )}

      <NewExpense club={club} onCreated={() => void load()} />

      <section className="an-card">
        <div className="an-title">Расходы за период</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Статья</th>
                <th>Сумма</th>
                <th>Заметка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.spentAt).toLocaleDateString("ru-KZ")}</td>
                  <td>{CATEGORY_LABEL[e.category] ?? e.category}</td>
                  <td className="num">{formatMoney(e.amount)}</td>
                  <td>{e.note ?? "—"}</td>
                  <td className="actions">
                    <button onClick={() => void remove(e.id)}>Удалить</button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={5}>За период расходов нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function NewExpense({
  club,
  onCreated,
}: {
  club: Club;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState("RENT");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState(todayKey());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const sum = amount.trim() === "" ? 0 : toTiyn(amount);
    if (sum <= 0) {
      setError("Укажите сумму");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createExpense(club.id, {
        category,
        amount: sum,
        spentAt: new Date(`${spentAt}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
      });
      setAmount("");
      setNote("");
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="an-card res-form" onSubmit={submit}>
      <div className="an-title">Новый расход</div>
      {error && <div className="error">{error}</div>}
      <div className="res-grid">
        <label>
          Статья
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сумма, ₸
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          Дата
          <input
            type="date"
            value={spentAt}
            onChange={(e) => setSpentAt(e.target.value || todayKey())}
          />
        </label>
        <label className="res-note">
          Заметка
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button className="primary" type="submit" disabled={busy}>
        Записать расход
      </button>
    </form>
  );
}
