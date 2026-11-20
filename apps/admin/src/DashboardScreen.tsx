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


function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}

/**
 * «Смена» — отчёт кассира по деньгам открытой смены, разнесённый на блоки,
 * чтобы не путать разное:
 *  • Деньги в кассу за смену — наличные + карта + онлайн, за вычетом возврата.
 *  • Касса — сверка наличных в ящике (начало, приход/расход ордера, остаток).
 *  • Выручка — чистый доход: игровое время + маржа бара.
 *  • Активность — сессии, чеки, средний чек; ниже — топ товаров.
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

  const barMargin = report.productsRevenue - report.productsCost;
  // Чистый доход за смену: заработок с компьютеров плюс только маржа бара
  // (не вся выручка бара — в ней сидит себестоимость товара).
  const earned = report.sessionsRevenue + barMargin;

  return (
    <main>
      <div className="dash-meta-row">
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
        <div className="dash-actions">
          {shiftId && (
            <ShiftOrderButton
              clubId={club.id}
              shiftId={shiftId}
              onChanged={() => void refresh()}
            />
          )}
          <button onClick={() => window.print()}>Печать Z-отчёта</button>
        </div>
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
          <div className="dash-rows">
            <div className="row">
              <span className="k">− Возврат (нал + карта)</span>
              <span>{formatMoney(report.cashRefunds + report.cardRefunds)}</span>
            </div>
          </div>
          <div className="dash-hint">
            Общая сумма = наличные + карта + онлайн, за вычетом возврата.
          </div>
        </section>

        {/* КАССА — сверка наличных в ящике на конец смены. */}
        <section className="dash-card">
          <div className="dash-title">Касса (наличные в ящике)</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Сумма на начало смены</span>
              <span>{formatMoney(report.openingFloat)}</span>
            </div>
            <div className="row">
              <span className="k">+ Наличными за смену</span>
              <span>{formatMoney(report.cashSales)}</span>
            </div>
            <div className="row">
              <span className="k">+ Приходный ордер (внесения)</span>
              <span>{formatMoney(report.cashDeposits)}</span>
            </div>
            <div className="row">
              <span className="k">− Расходный ордер (вынесения)</span>
              <span>{formatMoney(report.cashDrops + report.cashExpenses)}</span>
            </div>
            <div className="row">
              <span className="k">− Возврат наличными</span>
              <span>{formatMoney(report.cashRefunds)}</span>
            </div>
            <div className="row dash-total">
              <span className="k">Остаток в кассе наличными</span>
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
              <span className="k">Всего заработано за смену</span>
              <b>{formatMoney(earned)}</b>
            </div>
          </div>
          <div className="dash-hint">
            Чистый доход = игровое время + маржа бара.
          </div>
        </section>

        {/* Активность смены: сессии, чеки, средний чек. */}
        <section className="dash-card">
          <div className="dash-title">Активность смены</div>
          <div className="dash-rows">
            <div className="row">
              <span className="k">Сессий сыграно</span>
              <span>{report.sessionsCount}</span>
            </div>
            <div className="row">
              <span className="k">Чеков за смену</span>
              <span>{report.checksCount}</span>
            </div>
            <div className="row">
              <span className="k">Средний чек</span>
              <b>{formatMoney(report.averageCheck)}</b>
            </div>
          </div>
        </section>

        {/* Топ товаров по выручке. */}
        {report.topProducts.length > 0 && (
          <section className="dash-card">
            <div className="dash-title">Топ товаров</div>
            <div className="dash-rows">
              {report.topProducts.map((p) => (
                <div className="row" key={p.name}>
                  <span className="k">
                    {p.name} <i className="dash-qty">×{p.quantity}</i>
                  </span>
                  <span>{formatMoney(p.revenue)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Движения кассы за смену — список; ввод кнопкой «+ Ордер» в шапке. */}
        <CashMovementCard report={report} />

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

      <ZReport report={report} clubName={club.name} />
    </main>
  );
}

/**
 * Печатный бланк Z-отчёта. На экране скрыт, печатается по кнопке «Печать»:
 * чистый лист закрытия смены со всеми блоками — его подписывают при сдаче кассы.
 */
function ZReport({
  report,
  clubName,
}: {
  report: ShiftReport;
  clubName: string;
}) {
  const earned =
    report.sessionsRevenue + (report.productsRevenue - report.productsCost);
  const fmt = (n: number): string => formatMoney(n);
  const dt = (s: string): string =>
    new Date(s).toLocaleString("ru-KZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const line = (label: string, value: string, strong = false) => (
    <div className={`zr-line ${strong ? "zr-strong" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div className="zreport">
      <h1 className="zr-title">Z-отчёт смены</h1>
      <div className="zr-sub">
        {clubName} · смену вёл {report.staffName}
      </div>
      <div className="zr-sub">
        Открыта {dt(report.openedAt)}
        {report.closedAt
          ? ` · закрыта ${dt(report.closedAt)}`
          : " · не закрыта"}
        {" · "}
        {durationText(report.durationMinutes)}
      </div>

      <h2 className="zr-h2">Касса (наличные в ящике)</h2>
      {line("Сумма на начало смены", fmt(report.openingFloat))}
      {line("Наличными за смену", `+ ${fmt(report.cashSales)}`)}
      {line("Приходный ордер (внесения)", `+ ${fmt(report.cashDeposits)}`)}
      {line(
        "Расходный ордер (вынесения)",
        `− ${fmt(report.cashDrops + report.cashExpenses)}`,
      )}
      {line("Возврат наличными", `− ${fmt(report.cashRefunds)}`)}
      {line("Остаток в кассе наличными", fmt(report.cashExpected), true)}
      {report.reconciliation &&
        line("Пересчитано", fmt(report.reconciliation.counted))}
      {report.reconciliation &&
        line(
          "Расхождение",
          report.reconciliation.difference === 0
            ? "сошлось"
            : report.reconciliation.difference < 0
              ? `недостача ${fmt(Math.abs(report.reconciliation.difference))}`
              : `излишек ${fmt(report.reconciliation.difference)}`,
          true,
        )}

      <h2 className="zr-h2">Безнал</h2>
      {line(
        "Карта (система)",
        fmt(report.cardTotal) +
          (report.cardCounted !== null
            ? ` · по терминалу ${fmt(report.cardCounted)}`
            : ""),
      )}
      {line(
        "Онлайн / Kaspi (система)",
        fmt(report.onlineTotal) +
          (report.onlineCounted !== null
            ? ` · по выписке ${fmt(report.onlineCounted)}`
            : ""),
      )}
      {report.cardRefunds > 0 &&
        line("Возврат картой", `− ${fmt(report.cardRefunds)}`)}

      <h2 className="zr-h2">Выручка (заработано)</h2>
      {line("Игровое время", fmt(report.sessionsRevenue))}
      {line("Бар", fmt(report.productsRevenue))}
      {line("Маржа бара", fmt(report.productsRevenue - report.productsCost))}
      {line("Всего заработано за смену", fmt(earned), true)}

      <h2 className="zr-h2">Итоги</h2>
      {line("Деньги в кассу за смену", fmt(report.grandTotal), true)}
      {line("Возврат за смену", fmt(report.cashRefunds + report.cardRefunds))}
      {line("Сессий сыграно", String(report.sessionsCount))}
      {line("Чеков за смену", String(report.checksCount))}
      {line("Средний чек", fmt(report.averageCheck))}

      {report.cashMovements.length > 0 && (
        <>
          <h2 className="zr-h2">Движение наличных</h2>
          {report.cashMovements.map((m) => (
            <div className="zr-line" key={m.id}>
              <span>
                {new Date(m.at).toLocaleTimeString("ru-KZ", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {MOVEMENT_LABEL[m.kind] ?? m.kind}
                {m.kind === "REFUND" && m.method === "CARD" ? " · картой" : ""}
                {m.reason ? ` · ${m.reason}` : ""}
              </span>
              <span>
                {m.kind === "DEPOSIT" ? "+" : "−"}
                {fmt(m.amount)}
              </span>
            </div>
          ))}
        </>
      )}

      {report.topProducts.length > 0 && (
        <>
          <h2 className="zr-h2">Топ товаров</h2>
          {report.topProducts.map((p) => (
            <div className="zr-line" key={p.name}>
              <span>
                {p.name} ×{p.quantity}
              </span>
              <span>{fmt(p.revenue)}</span>
            </div>
          ))}
        </>
      )}

      <div className="zr-signs">
        <div>Кассир ____________________</div>
        <div>Принял ____________________</div>
      </div>
    </div>
  );
}

/**
 * Кнопка «+ Ордер» в шапке смены: быстрый приходный или расходный кассовый
 * ордер. Расход — деньги взяли из кассы (минус наличные смены); приход —
 * внесли в кассу (плюс). Обе записи — обычное движение наличных.
 */
function ShiftOrderButton({
  clubId,
  shiftId,
  onChanged,
}: {
  clubId: string;
  shiftId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"DEPOSIT" | "EXPENSE" | "REFUND">("EXPENSE");
  // Способ возврата: наличными (из ящика) или картой (по чеку на пост-терминале).
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setOpen(false);
    setAmount("");
    setReason("");
    setError(null);
    setBusy(false);
  }

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
        ...(kind === "REFUND" ? { method } : {}),
      });
      onChanged();
      close();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="dash-plus"
        title="Приходный / расходный ордер, возврат"
        onClick={() => setOpen(true)}
      >
        + Ордер
      </button>
      {open && (
        <div className="order-backdrop" onClick={close}>
          <div className="order-pop" onClick={(e) => e.stopPropagation()}>
            <div className="dash-title">Кассовый ордер</div>
            {error && <div className="error">{error}</div>}
            <div className="seg">
              <button
                className={kind === "EXPENSE" ? "on" : ""}
                onClick={() => setKind("EXPENSE")}
              >
                Расходный
              </button>
              <button
                className={kind === "DEPOSIT" ? "on" : ""}
                onClick={() => setKind("DEPOSIT")}
              >
                Приходный
              </button>
              <button
                className={kind === "REFUND" ? "on" : ""}
                onClick={() => setKind("REFUND")}
              >
                Возврат
              </button>
            </div>
            {kind === "REFUND" && (
              <div className="seg">
                <button
                  className={method === "CASH" ? "on" : ""}
                  onClick={() => setMethod("CASH")}
                >
                  Наличными
                </button>
                <button
                  className={method === "CARD" ? "on" : ""}
                  onClick={() => setMethod("CARD")}
                >
                  Картой
                </button>
              </div>
            )}
            <input
              inputMode="numeric"
              placeholder="Сумма, ₸"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              placeholder={
                kind === "EXPENSE"
                  ? "За что (напр. закупка воды, инкассация)"
                  : kind === "REFUND"
                    ? "За что возврат"
                    : "Основание"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="order-hint">
              {kind === "EXPENSE"
                ? "Деньги взяли из кассы (закупка, инкассация) — минус из наличных смены."
                : kind === "DEPOSIT"
                  ? "Деньги внесли в кассу — плюс к наличным смены."
                  : method === "CASH"
                    ? "Возврат наличными — минус из наличных и из общей суммы."
                    : "Возврат картой по чеку — минус из безнала и из общей суммы."}
            </div>
            <div className="order-actions">
              <button onClick={close}>Отмена</button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void save()}
              >
                Провести
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Запись движения наличных и список движений смены. */
/** Список кассовых движений смены. Ввод — кнопкой «+ Ордер» в шапке смены. */
function CashMovementCard({ report }: { report: ShiftReport }) {
  if (report.cashMovements.length === 0) return null;
  return (
    <section className="dash-card dash-wide">
      <div className="dash-title">Движения кассы за смену</div>

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
                {m.kind === "REFUND" && m.method === "CARD" ? " · картой" : ""}
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
