import { useCallback, useEffect, useState } from "react";

import {
  type Club,
  type ShiftReport,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

const METHOD_LABEL: Record<string, string> = {
  CASH: "наличные",
  CARD: "карта",
  ONLINE: "онлайн",
  BALANCE: "с баланса",
  BONUS: "бонусы",
};

const MOVEMENT_LABEL: Record<string, string> = {
  DEPOSIT: "Внесение",
  DROP: "Выемка",
  EXPENSE: "Расход",
  REFUND: "Возврат",
};

/** Виды движения: внесение добавляет наличные в кассу, остальные — убавляют. */
const MOVEMENT_KINDS: Array<{ kind: string; action: string }> = [
  { kind: "DEPOSIT", action: "Внести" },
  { kind: "DROP", action: "Изъять" },
  { kind: "EXPENSE", action: "Расход" },
  { kind: "REFUND", action: "Возврат" },
];

function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}

/**
 * «Смена» — отчёт кассира по деньгам открытой смены, разнесённый на три блока,
 * чтобы не путать разное:
 *  • Касса — сверка наличных в ящике (с учётом внесений, выемок, расходов).
 *  • Выручка — что клуб заработал (игровое время + бар). Пополнение сюда НЕ
 *    входит: это предоплата, а не заработок.
 *  • Предоплаты — сколько гости занесли на балансы и сколько с них потратили.
 */
export function DashboardScreen({ club }: { club: Club }) {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [hasShift, setHasShift] = useState(true);

  const refresh = useCallback(async () => {
    const shift = await api.currentShift(club.id);
    if (!shift) {
      setHasShift(false);
      setReport(null);
      setShiftId(null);
      return;
    }
    setHasShift(true);
    setShiftId(shift.id);
    setReport(await api.shiftReport(club.id, shift.id));
  }, [club.id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!hasShift) {
    return (
      <main>
        <div className="notice">
          Смена не открыта. Откройте смену наверху — и здесь появятся деньги
          дня.
        </div>
      </main>
    );
  }
  if (!report) {
    return (
      <main>
        <div className="notice">Загрузка…</div>
      </main>
    );
  }

  const share = (part: number): number =>
    report.grandTotal > 0 ? Math.round((part / report.grandTotal) * 100) : 0;

  const earned = report.sessionsRevenue + report.productsRevenue;
  const barMargin = report.productsRevenue - report.productsCost;

  return (
    <main>
      <div className="dash-meta">
        Открыта{" "}
        {new Date(report.openedAt).toLocaleString("ru-KZ", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {report.closedAt && (
          <>
            {" · закрыта "}
            {new Date(report.closedAt).toLocaleString("ru-KZ", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </>
        )}
        {" · "}
        {durationText(report.durationMinutes)}
      </div>

      <div className="dash-grid">
        <section className="dash-card dash-wide">
          <div className="dash-title">Деньги в кассу за смену</div>
          <div className="dash-big">{formatMoney(report.grandTotal)}</div>
          <div className="dash-split">
            <div className="dash-pay">
              <span className="dash-dot cash" />
              <span className="dash-pay-name">Наличные</span>
              <b>{formatMoney(report.cashTotal)}</b>
              <i>{share(report.cashTotal)}%</i>
            </div>
            <div className="dash-pay">
              <span className="dash-dot card" />
              <span className="dash-pay-name">Карта</span>
              <b>{formatMoney(report.cardTotal)}</b>
              <i>{share(report.cardTotal)}%</i>
            </div>
            <div className="dash-pay">
              <span className="dash-dot online" />
              <span className="dash-pay-name">Онлайн</span>
              <b>{formatMoney(report.onlineTotal)}</b>
              <i>{share(report.onlineTotal)}%</i>
            </div>
          </div>
        </section>

        {/* КАССА — сверка наличных в ящике. */}
        <section className="dash-card">
          <div className="dash-title">Касса (наличные)</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Размен на начало</span>
              <span>{formatMoney(report.openingFloat)}</span>
            </div>
            <div className="row">
              <span className="k">+ Продажи наличными</span>
              <span>{formatMoney(report.cashSales)}</span>
            </div>
            <div className="row">
              <span className="k">+ Внесения</span>
              <span>{formatMoney(report.cashDeposits)}</span>
            </div>
            <div className="row">
              <span className="k">− Выемки</span>
              <span>{formatMoney(report.cashDrops)}</span>
            </div>
            <div className="row">
              <span className="k">− Расходы</span>
              <span>{formatMoney(report.cashExpenses)}</span>
            </div>
            <div className="row">
              <span className="k">− Возвраты</span>
              <span>{formatMoney(report.cashRefunds)}</span>
            </div>
            <div className="row dash-total">
              <span className="k">Должно быть в кассе</span>
              <b>{formatMoney(report.cashExpected)}</b>
            </div>
          </div>
        </section>

        {/* ВЫРУЧКА — что клуб заработал. */}
        <section className="dash-card">
          <div className="dash-title">Выручка (заработано)</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Игровое время</span>
              <span>{formatMoney(report.sessionsRevenue)}</span>
            </div>
            <div className="row">
              <span className="k">Бар</span>
              <span>{formatMoney(report.productsRevenue)}</span>
            </div>
            <div className="row">
              <span className="k">Маржа бара</span>
              <span>{formatMoney(barMargin)}</span>
            </div>
            <div className="row dash-total">
              <span className="k">Всего заработано</span>
              <b>{formatMoney(earned)}</b>
            </div>
          </div>
        </section>

        {/* ПРЕДОПЛАТЫ — движение по балансам гостей. */}
        <section className="dash-card">
          <div className="dash-title">Предоплаты (балансы)</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Пополнено балансов</span>
              <span>{formatMoney(report.clubTopUps)}</span>
            </div>
            <div className="row">
              <span className="k">Потрачено с баланса</span>
              <span>{formatMoney(report.balanceTotal)}</span>
            </div>
            <div className="row">
              <span className="k">Сессий сыграно</span>
              <span>{report.sessionsCount}</span>
            </div>
          </div>
          <div className="dash-hint">
            Пополнение — это предоплата, а не выручка: гость занёс деньги, но
            ещё не отыграл.
          </div>
        </section>

        {/* Движение наличных — запись и список. */}
        {shiftId && (
          <CashMovementCard
            clubId={club.id}
            shiftId={shiftId}
            report={report}
            onChanged={() => void refresh()}
          />
        )}

        <section className="dash-card dash-wide">
          <div className="dash-title">Действия за смену</div>
          {report.operations.length === 0 ? (
            <div className="dash-rows">
              <div className="row">
                <span className="k">Пока ничего не пробито</span>
              </div>
            </div>
          ) : (
            <div className="dash-rows dash-ops">
              {report.operations.map((op) => (
                <div className="row" key={op.id}>
                  <span className="k">
                    {new Date(op.at).toLocaleTimeString("ru-KZ", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {op.title}
                  </span>
                  <span>
                    {formatMoney(op.amount)}
                    <i> · {METHOD_LABEL[op.method] ?? op.method}</i>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/** Запись движения наличных и список движений смены. */
function CashMovementCard({
  clubId,
  shiftId,
  report,
  onChanged,
}: {
  clubId: string;
  shiftId: string;
  report: ShiftReport;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const sum = toTiyn(amount);
    if (sum <= 0) {
      setError("Укажите сумму");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addCashMovement(clubId, shiftId, {
        kind,
        amount: sum,
        reason: reason.trim() || undefined,
      });
      setAmount("");
      setReason("");
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card dash-wide">
      <div className="dash-title">Движение наличных</div>

      {error && <div className="error">{error}</div>}

      <div className="cash-move-form">
        <div className="seg">
          {MOVEMENT_KINDS.map((m) => (
            <button
              key={m.kind}
              className={kind === m.kind ? "on" : ""}
              onClick={() => setKind(m.kind)}
            >
              {m.action}
            </button>
          ))}
        </div>
        <input
          inputMode="numeric"
          placeholder="Сумма, ₸"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          placeholder="Причина (за что)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Записать
        </button>
      </div>

      {report.cashMovements.length > 0 && (
        <div className="dash-rows dash-ops">
          {report.cashMovements.map((m) => (
            <div className="row" key={m.id}>
              <span className="k">
                {new Date(m.at).toLocaleTimeString("ru-KZ", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {MOVEMENT_LABEL[m.kind] ?? m.kind}
                {m.reason ? ` · ${m.reason}` : ""}
              </span>
              <span>
                {m.kind === "DEPOSIT" ? "+" : "−"}
                {formatMoney(m.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
