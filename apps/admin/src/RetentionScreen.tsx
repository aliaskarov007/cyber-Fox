import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { Tab } from "./App.js";
import {
  type Club,
  type PromoKind,
  type RetentionGuest,
  type RetentionReport,
  type WinbackCampaign,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

const STATUS_LABEL: Record<RetentionGuest["status"], string> = {
  active: "ходит",
  at_risk: "под угрозой",
  lost: "ушёл",
};

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number) as [number, number];
  return `${MONTHS[month - 1]} ${String(year).slice(2)}`;
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-KZ", { day: "numeric", month: "short" });
}

const DEFAULT_TEXT =
  "{имя}, давно вас не видели в «{клуб}»! Дарим {подарок} по промокоду {код} — " +
  "введите его за компьютером после входа. Код действует до {до}.";

/**
 * Отток гостей зала: кто из постоянных пропал, сколько он приносил, и возврат
 * личными промокодами в WhatsApp с итогами — кто ввёл код и вернулся.
 */
export function RetentionScreen({ club, onGoTo }: { club: Club; onGoTo: (tab: Tab) => void }) {
  const [days, setDays] = useState(30);
  const [minVisits, setMinVisits] = useState(3);
  const [filter, setFilter] = useState<"lost" | "at_risk" | "all">("lost");
  const [report, setReport] = useState<RetentionReport | null>(null);
  const [campaigns, setCampaigns] = useState<WinbackCampaign[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextReport, nextCampaigns] = await Promise.all([
        api.retention(club.id, days, minVisits),
        api.winbackCampaigns(club.id),
      ]);
      setReport(nextReport);
      setCampaigns(nextCampaigns);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [club.id, days, minVisits]);

  useEffect(() => {
    setSelected(new Set());
    void load();
  }, [load]);

  // Пока рассылка идёт, цифры меняются сами.
  const sending = campaigns.some((c) => c.pending > 0);
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void api.winbackCampaigns(club.id).then(setCampaigns), 5_000);
    return () => clearInterval(timer);
  }, [sending, club.id]);

  const rows = useMemo(
    () => (report?.guests ?? []).filter((g) => filter === "all" || g.status === filter),
    [report, filter],
  );
  const selectable = rows.filter((g) => g.blockedReason === null);
  const allSelected = selectable.length > 0 && selectable.every((g) => selected.has(g.guestId));

  function toggle(guestId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(guestId)) next.delete(guestId);
      else next.add(guestId);
      return next;
    });
  }

  if (!report) {
    return (
      <main>
        {error ? <div className="error">{error}</div> : <div className="notice">Считаем…</div>}
      </main>
    );
  }

  const { totals } = report;

  return (
    <main>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="filters">
        <label>
          Ушедшим считать после
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[14, 21, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} дней без визита
              </option>
            ))}
          </select>
        </label>
        <label>
          Постоянный гость — от
          <select value={minVisits} onChange={(e) => setMinVisits(Number(e.target.value))}>
            {[2, 3, 5, 10].map((v) => (
              <option key={v} value={v}>
                {v} визитов
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="summary">
        <div className="stat">
          <div className="value">{totals.regulars}</div>
          <div className="label">Постоянных гостей за год · ходят {totals.active}</div>
        </div>
        <div className={`stat ${totals.atRisk > 0 ? "alert" : ""}`}>
          <div className="value">{totals.atRisk}</div>
          <div className="label">
            Под угрозой · приносили {formatMoney(totals.atRiskMonthlySpend)} в месяц
          </div>
        </div>
        <div className={`stat ${totals.lost > 0 ? "alert" : ""}`}>
          <div className="value">{totals.lost}</div>
          <div className="label">Ушли · приносили {formatMoney(totals.lostMonthlySpend)} в месяц</div>
        </div>
      </div>

      <ChurnChart byMonth={report.byMonth} />

      {campaigns.length > 0 && <CampaignList campaigns={campaigns} />}

      <section className="zone-block">
        <div className="zone-head">
          <h2>Кого возвращать</h2>
          <div className="link-tabs" role="tablist">
            {(
              [
                ["lost", `Ушли · ${totals.lost}`],
                ["at_risk", `Под угрозой · ${totals.atRisk}`],
                ["all", "Все"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-current={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button
            className="primary"
            disabled={selected.size === 0}
            onClick={() => {
              setNotice(null);
              setComposing(true);
            }}
          >
            Отправить промокод · {selected.size}
          </button>
        </div>

        {!report.whatsappConnected && (
          <div className="notice warn">
            WhatsApp не подключён — промокоды не уйдут. Владелец сети подключает его в{" "}
            <button className="link" onClick={() => onGoTo("settings")}>
              «Настройках»
            </button>
            .
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Выбрать всех, кому можно написать"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(selectable.map((g) => g.guestId)))
                    }
                  />
                </th>
                <th>Гость</th>
                <th>Статус</th>
                <th>Не был</th>
                <th>Ходил</th>
                <th>Приносил в месяц</th>
                <th>Обычно</th>
                <th>Написать</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((guest) => (
                <tr key={guest.guestId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Выбрать ${guest.fullName}`}
                      checked={selected.has(guest.guestId)}
                      disabled={guest.blockedReason !== null}
                      onChange={() => toggle(guest.guestId)}
                    />
                  </td>
                  <td>
                    {guest.fullName}
                    <div className="sub num">{guest.phone}</div>
                  </td>
                  <td>
                    <span className={`chip ${guest.status === "lost" ? "maintenance" : "credit"}`}>
                      {STATUS_LABEL[guest.status]}
                    </span>
                  </td>
                  <td className="num">
                    {guest.daysSince} дн.
                    <div className="sub">с {date(guest.lastAt)}</div>
                  </td>
                  <td className="num">
                    {guest.visits} визитов
                    {guest.rhythmDays !== null && (
                      <div className="sub">раз в {Math.max(1, Math.round(guest.rhythmDays))} дн.</div>
                    )}
                  </td>
                  <td className="num">
                    {formatMoney(guest.monthlySpend)}
                    <div className="sub">всего {formatMoney(guest.spent)}</div>
                  </td>
                  <td>{[guest.usualZone, guest.usualTime].filter(Boolean).join(", ") || "—"}</td>
                  <td className="sub">{guest.blockedReason ?? "можно"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>
                    {filter === "lost"
                      ? "Ушедших постоянных гостей нет."
                      : filter === "at_risk"
                        ? "Под угрозой никого."
                        : "Пусто."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Написать можно только гостям с подтверждённым в WhatsApp номером, которые не
          отписывались. Одному гостю — не чаще раза в месяц: настойчивость выглядит как спам, а за
          спам WhatsApp блокирует номер клуба.
        </p>
      </section>

      {composing && (
        <>
          <button className="backdrop" aria-label="Закрыть" onClick={() => setComposing(false)} />
          <aside className="drawer">
            <WinbackForm
              club={club}
              guestIds={[...selected]}
              onDone={(message) => {
                setComposing(false);
                setSelected(new Set());
                setNotice(message);
                void load();
              }}
              onCancel={() => setComposing(false)}
            />
          </aside>
        </>
      )}
    </main>
  );
}

/**
 * Сколько постоянных гостей ушло по месяцам — по месяцу последнего визита.
 * Один ряд — один цвет, легенда не нужна: что это, говорит заголовок.
 */
function ChurnChart({ byMonth }: { byMonth: RetentionReport["byMonth"] }) {
  const max = Math.max(1, ...byMonth.map((m) => m.guests));
  const total = byMonth.reduce((s, m) => s + m.guests, 0);

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Когда уходили</h2>
        <span className="sub">по месяцу последнего визита, за полгода</span>
      </div>
      {total === 0 ? (
        <div className="notice">За полгода постоянные гости не уходили.</div>
      ) : (
        <>
          <div className="churn-chart" role="img" aria-label="Ушедшие гости по месяцам">
            {byMonth.map((m) => (
              <div
                className="churn-col"
                key={m.month}
                title={`${monthLabel(m.month)}: ушли ${m.guests}, приносили ${formatMoney(m.monthlySpend)} в месяц`}
              >
                <span className="churn-value">{m.guests > 0 ? m.guests : ""}</span>
                <span className="churn-bar" style={{ height: `calc((100% - 44px) * ${m.guests / max})` }} />
                <span className="churn-month">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
          {/* Та же картина таблицей — для тех, кому нужны точные суммы. */}
          <details className="sub">
            <summary>Таблицей</summary>
            <table>
              <tbody>
                {byMonth.map((m) => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td className="num">{m.guests} гостей</td>
                    <td className="num">{formatMoney(m.monthlySpend)} в месяц</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function CampaignList({ campaigns }: { campaigns: WinbackCampaign[] }) {
  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Рассылки и результат</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Когда</th>
              <th>Подарок</th>
              <th>Отправлено</th>
              <th>Ввели код</th>
              <th>Вернулись</th>
              <th>Принесли после</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>{date(c.createdAt)}</td>
                <td>
                  {formatMoney(c.amount)} {c.kind === "BALANCE" ? "на счёт" : "бонусами"} · {c.validDays} дн.
                </td>
                <td className="num">
                  {c.sent} из {c.total}
                  {c.pending > 0 && <div className="sub">в очереди {c.pending}</div>}
                  {c.failed > 0 && <div className="sub">не ушло {c.failed}</div>}
                </td>
                <td className="num">{c.redeemed}</td>
                <td className="num">
                  {c.returned}
                  {c.sent > 0 && <div className="sub">{Math.round((c.returned / c.sent) * 100)}%</div>}
                </td>
                <td className="num">
                  {formatMoney(c.revenueAfter)}
                  {/* Окупилась ли раздача: сколько принесли против подаренного. */}
                  {c.redeemed > 0 && c.kind === "BALANCE" && (
                    <div className="sub">подарено {formatMoney(c.redeemed * c.amount)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        «Вернулись» — снова играли в зале после сообщения, с кодом или без. «Принесли после» —
        их траты на игру с того момента.
      </p>
    </section>
  );
}

function WinbackForm({
  club,
  guestIds,
  onDone,
  onCancel,
}: {
  club: Club;
  guestIds: string[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PromoKind>("BALANCE");
  const [amount, setAmount] = useState("1000");
  const [validDays, setValidDays] = useState(14);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tiyn = toTiyn(amount);
  const gift = `${(tiyn / 100).toLocaleString("ru-KZ")} ${kind === "BALANCE" ? "₸ на счёт" : "бонусов"}`;
  const until = new Date(Date.now() + validDays * 86_400_000).toLocaleDateString("ru-KZ", {
    day: "numeric",
    month: "long",
  });
  const preview =
    text
      .replaceAll("{имя}", "Айдар")
      .replaceAll("{клуб}", club.name)
      .replaceAll("{подарок}", gift)
      .replaceAll("{код}", "K7QX2M4P")
      .replaceAll("{до}", until) + "\n\nЧтобы не получать сообщения, ответьте СТОП.";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!Number.isFinite(tiyn) || tiyn < 100) throw new Error("Подарок — от 1 ₸");
      if (!text.includes("{код}")) throw new Error("В тексте нет {код} — гость не узнает свой промокод");
      const total = (tiyn * guestIds.length) / 100;
      if (
        kind === "BALANCE" &&
        !window.confirm(
          `Отправить ${guestIds.length} гостям по ${formatMoney(tiyn)}? ` +
            `Если все введут код, клуб подарит до ${total.toLocaleString("ru-KZ")} ₸.`,
        )
      ) {
        return;
      }
      const result = await api.createWinback(club.id, {
        guestIds,
        kind,
        amount: tiyn,
        validDays,
        message: text.trim() === DEFAULT_TEXT ? undefined : text,
      });
      onDone(
        `Промокоды уходят ${result.queued} гостям — по одному сообщению в полторы секунды.` +
          (result.skipped > 0 ? ` Пропущено ${result.skipped}: им писать нельзя.` : ""),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="drawer-head">
        <h2>Вернуть гостей</h2>
        <span className="chip idle">{guestIds.length} выбрано</span>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="section">
        <h3>Подарок</h3>
        <div className="settings-grid">
          <label>
            Что даём
            <select value={kind} onChange={(e) => setKind(e.target.value as PromoKind)}>
              <option value="BALANCE">Деньги на счёт</option>
              <option value="BONUS">Бонусы</option>
            </select>
          </label>
          <label>
            Сколько, ₸
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Код действует
            <select value={validDays} onChange={(e) => setValidDays(Number(e.target.value))}>
              {[7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} дней
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          Каждому гостю — свой одноразовый код: переслать его другу бесполезно.
        </p>
      </div>

      <div className="section">
        <h3>Текст</h3>
        <textarea rows={5} maxLength={700} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="hint">
          Подставится само: {"{имя}"}, {"{клуб}"}, {"{подарок}"}, {"{код}"}, {"{до}"}. Строка про «СТОП»
          добавляется всегда.
        </p>
        <h3>Так увидит гость</h3>
        <div className="message-preview">{preview}</div>
      </div>

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Отправляем…" : `Отправить ${guestIds.length}`}
        </button>
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
