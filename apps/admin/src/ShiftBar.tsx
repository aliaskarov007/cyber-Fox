import { useCallback, useEffect, useState } from "react";

import { type Club, type Shift, type ShiftReport, api, formatMoney, toTiyn } from "./api.js";

/**
 * Панель смены в шапке. Открыта смена или нет — первое, что должен видеть
 * администратор: без открытой смены платежи не привяжутся к кассе и сверка
 * на закрытии не сойдётся.
 */
export function ShiftBar({ club }: { club: Club }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    // Смены может не быть — тогда сервер отвечает пустым телом.
    const current = (await api.currentShift(club.id)) ?? null;
    setShift(current);
    setReport(current ? await api.shiftReport(club.id, current.id) : null);
  }, [club.id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <>
      <button
        className={shift ? "shift-chip open" : "shift-chip closed"}
        onClick={() => setOpen(true)}
      >
        {shift ? (
          <>
            Смена открыта
            {report && <b>{formatMoney(report.cashExpected)}</b>}
          </>
        ) : (
          "Смена не открыта"
        )}
      </button>

      {open && (
        <>
          <button className="backdrop" aria-label="Закрыть" onClick={() => setOpen(false)} />
          <aside className="drawer">
            <ShiftPanel
              club={club}
              shift={shift}
              report={report}
              onChanged={() => {
                void refresh();
              }}
              onClose={() => setOpen(false)}
            />
          </aside>
        </>
      )}
    </>
  );
}

function ShiftPanel({
  club,
  shift,
  report,
  onChanged,
  onClose,
}: {
  club: Club;
  shift: Shift | null;
  report: ShiftReport | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [float, setFloat] = useState("5000");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShiftReport | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result?.reconciliation) {
    const { difference, status, expected, counted: got } = result.reconciliation;
    return (
      <>
        <div className="drawer-head">
          <h2>Смена закрыта</h2>
        </div>

        <div
          className={
            status === "MATCH" ? "notice" : status === "SHORTAGE" ? "error" : "notice warn"
          }
        >
          {status === "MATCH"
            ? "Касса сошлась."
            : status === "SHORTAGE"
              ? `Недостача ${formatMoney(Math.abs(difference))}.`
              : `Излишек ${formatMoney(difference)}.`}
        </div>

        <div className="section">
          <h3>Касса</h3>
          <div className="rows">
            <div className="row">
              <span className="k">Ожидалось</span>
              <span>{formatMoney(expected)}</span>
            </div>
            <div className="row">
              <span className="k">Пересчитано</span>
              <span>{formatMoney(got)}</span>
            </div>
          </div>
        </div>

        <ReportRows report={result} />
        <button onClick={onClose}>Закрыть</button>
      </>
    );
  }

  if (!shift) {
    return (
      <>
        <div className="drawer-head">
          <h2>Открыть смену</h2>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="notice">
          Пока смена не открыта, платежи не привяжутся к кассе, и сверить её на закрытии не выйдет.
        </div>

        <div className="section">
          <h3>Размен в кассе</h3>
          <input
            inputMode="decimal"
            value={float}
            onChange={(e) => setFloat(e.target.value)}
            aria-label="Размен в тенге"
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(() => api.openShift(club.id, toTiyn(float)))}
          >
            Открыть смену
          </button>
        </div>

        <button onClick={onClose}>Отмена</button>
      </>
    );
  }

  return (
    <>
      <div className="drawer-head">
        <h2>Смена</h2>
        <span className="chip in-use">открыта</span>
      </div>

      {error && <div className="error">{error}</div>}

      {report && <ReportRows report={report} />}

      <div className="section">
        <h3>Закрыть смену</h3>
        <div className="notice">
          Пересчитайте наличные в ящике и введите сумму. Расхождение останется в истории — его
          фиксируют, а не исправляют.
        </div>
        <label>
          Пересчитано наличных, ₸
          <input
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder={report ? String(report.cashExpected / 100) : ""}
          />
        </label>
        <label>
          Комментарий
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          className="danger"
          disabled={busy || counted.trim() === ""}
          onClick={() =>
            void run(async () => {
              const closed = await api.closeShift(club.id, shift.id, toTiyn(counted), note);
              setResult(closed);
            })
          }
        >
          Закрыть смену
        </button>
      </div>

      <button onClick={onClose}>Отмена</button>
    </>
  );
}

function ReportRows({ report }: { report: ShiftReport }) {
  return (
    <div className="section">
      <h3>Итоги смены</h3>
      <div className="rows">
        <div className="row">
          <span className="k">Смену ведёт</span>
          <span>{report.staffName}</span>
        </div>
        <div className="row">
          <span className="k">Размен</span>
          <span>{formatMoney(report.shift.openingFloat)}</span>
        </div>
        <div className="row">
          <span className="k">Наличных должно быть</span>
          <span>{formatMoney(report.cashExpected)}</span>
        </div>
        <div className="row">
          <span className="k">Картой</span>
          <span>{formatMoney(report.cardTotal)}</span>
        </div>
      </div>

      <div className="rows">
        <div className="row">
          <span className="k">Выручка от времени</span>
          <span>{formatMoney(report.sessionsRevenue)}</span>
        </div>
        <div className="row">
          <span className="k">Выручка бара</span>
          <span>{formatMoney(report.productsRevenue)}</span>
        </div>
        <div className="row">
          <span className="k">Маржа бара</span>
          <span>{formatMoney(report.productsRevenue - report.productsCost)}</span>
        </div>
        <div className="row">
          <span className="k">Сессий за смену</span>
          <span>{report.sessionsCount}</span>
        </div>
      </div>

      {/* Выручка и наличные — разные числа: гость мог пополнить счёт в прошлую смену. */}
      <div className="notice">
        Выручка смены — {formatMoney(report.revenue)}. Она не равна наличным в кассе: время могло
        оплачиваться с баланса, пополненного раньше.
      </div>
    </div>
  );
}
