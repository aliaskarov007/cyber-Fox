import { useCallback, useEffect, useState } from "react";

import {
  type Club,
  type Shift,
  type ShiftReport,
  type Staff,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

/**
 * Панель смены в шапке. Открыта смена или нет — первое, что должен видеть
 * администратор: без открытой смены платежи не привяжутся к кассе и сверка
 * на закрытии не сойдётся.
 */
export function ShiftBar({ club, staff }: { club: Club; staff: Staff }) {
  // Маржу (а значит себестоимость) видят только владелец и управляющий.
  const canSeeMargin = staff.role === "OWNER" || staff.role === "ADMIN";
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
          <button
            className="backdrop"
            aria-label="Закрыть"
            onClick={() => setOpen(false)}
          />
          <aside className="drawer">
            <ShiftPanel
              club={club}
              shift={shift}
              report={report}
              canSeeMargin={canSeeMargin}
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
  canSeeMargin,
  onChanged,
  onClose,
}: {
  club: Club;
  shift: Shift | null;
  report: ShiftReport | null;
  canSeeMargin: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [float, setFloat] = useState("5000");
  const [counted, setCounted] = useState("");
  const [cardCounted, setCardCounted] = useState("");
  const [onlineCounted, setOnlineCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShiftReport | null>(null);
  const [handover, setHandover] = useState<{
    suggestedFloat: number;
    fromStaff: string;
  } | null>(null);

  // Пересменка: когда смена не открыта, подставляем разменом пересчёт прошлой.
  useEffect(() => {
    if (shift) return;
    let alive = true;
    void api.shiftHandover(club.id).then((h) => {
      if (alive && h) {
        setHandover({
          suggestedFloat: h.suggestedFloat,
          fromStaff: h.fromStaff,
        });
        setFloat(String(h.suggestedFloat / 100));
      }
    });
    return () => {
      alive = false;
    };
  }, [shift, club.id]);

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
    const {
      difference,
      status,
      expected,
      counted: got,
    } = result.reconciliation;
    return (
      <>
        <div className="drawer-head">
          <h2>Смена закрыта</h2>
        </div>

        <div
          className={
            status === "MATCH"
              ? "notice"
              : status === "SHORTAGE"
                ? "error"
                : "notice warn"
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

        {(result.cardCounted !== null || result.onlineCounted !== null) && (
          <div className="section">
            <h3>Безнал</h3>
            <div className="rows">
              {result.cardCounted !== null && (
                <CashlessRow
                  label="Карта"
                  expected={result.cardTotal}
                  counted={result.cardCounted}
                />
              )}
              {result.onlineCounted !== null && (
                <CashlessRow
                  label="Kaspi / онлайн"
                  expected={result.onlineTotal}
                  counted={result.onlineCounted}
                />
              )}
            </div>
          </div>
        )}

        {result.closedAt && (
          <div className="notice">
            Закрыта{" "}
            {new Date(result.closedAt).toLocaleString("ru-KZ", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · смена длилась {Math.floor(result.durationMinutes / 60)} ч{" "}
            {result.durationMinutes % 60} мин
          </div>
        )}

        <ReportRows report={result} canSeeMargin={canSeeMargin} />
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
          Пока смена не открыта, платежи не привяжутся к кассе, и сверить её на
          закрытии не выйдет.
        </div>

        {handover && (
          <div className="notice">
            Принято из прошлой смены (пересчёт кассира {handover.fromStaff}):{" "}
            <b>{formatMoney(handover.suggestedFloat)}</b>. Подставлено разменом
            — поправьте, если забрали часть.
          </div>
        )}

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
            onClick={() =>
              void run(() => api.openShift(club.id, toTiyn(float)))
            }
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

      {report && <ReportRows report={report} canSeeMargin={canSeeMargin} />}

      <div className="section">
        <h3>Закрыть смену</h3>
        <div className="notice">
          Пересчитайте наличные в ящике и введите сумму. Расхождение останется в
          истории — его фиксируют, а не исправляют.
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
        {/* Сверка безнала — по желанию: карта по терминалу, Kaspi по выписке. */}
        <label>
          Карта по терминалу, ₸ (если сверяете)
          <input
            inputMode="decimal"
            value={cardCounted}
            onChange={(e) => setCardCounted(e.target.value)}
            placeholder={report ? String(report.cardTotal / 100) : ""}
          />
        </label>
        <label>
          Онлайн по выписке Kaspi, ₸ (если сверяете)
          <input
            inputMode="decimal"
            value={onlineCounted}
            onChange={(e) => setOnlineCounted(e.target.value)}
            placeholder={report ? String(report.onlineTotal / 100) : ""}
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
              const closed = await api.closeShift(club.id, shift.id, {
                cashCounted: toTiyn(counted),
                note,
                cardCounted:
                  cardCounted.trim() === "" ? undefined : toTiyn(cardCounted),
                onlineCounted:
                  onlineCounted.trim() === ""
                    ? undefined
                    : toTiyn(onlineCounted),
              });
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

function ReportRows({
  report,
  canSeeMargin,
}: {
  report: ShiftReport;
  canSeeMargin: boolean;
}) {
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
        {/* Маржа = себестоимость наружу. Её видят только владелец и управляющий. */}
        {canSeeMargin && (
          <div className="row">
            <span className="k">Маржа бара</span>
            <span>
              {formatMoney(report.productsRevenue - report.productsCost)}
            </span>
          </div>
        )}
        {report.tournamentNet !== 0 && (
          <div className="row">
            {/* Отрицательный итог — обычное дело: клуб доложил в фонд своих. */}
            <span className="k">
              Турниры{report.tournamentNet < 0 ? " (клуб доложил)" : ""}
            </span>
            <span>{formatMoney(report.tournamentNet)}</span>
          </div>
        )}
        <div className="row">
          <span className="k">Сессий за смену</span>
          <span>{report.sessionsCount}</span>
        </div>
      </div>

      {/* Выручка и наличные — разные числа: гость мог пополнить счёт в прошлую смену. */}
      <div className="notice">
        Выручка смены — {formatMoney(report.revenue)}. Она не равна наличным в
        кассе: время могло оплачиваться с баланса, пополненного раньше.
      </div>
    </div>
  );
}

/** Строка сверки безнала: пересчитано против ожидаемого, с разницей. */
function CashlessRow({
  label,
  expected,
  counted,
}: {
  label: string;
  expected: number;
  counted: number;
}) {
  const diff = counted - expected;
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span>
        {formatMoney(counted)}
        <i style={{ fontStyle: "normal", color: "var(--muted)" }}>
          {diff === 0
            ? " · сошлось"
            : diff < 0
              ? ` · недостача ${formatMoney(Math.abs(diff))}`
              : ` · излишек ${formatMoney(diff)}`}
        </i>
      </span>
    </div>
  );
}
