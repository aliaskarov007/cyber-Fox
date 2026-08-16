import { useCallback, useEffect, useState } from "react";

import {
  type Club,
  type ClubSummary,
  type ComputerPerformance,
  type HourlyPoint,
  type Settlement,
  api,
  formatMoney,
} from "./api.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = [
  { id: "day", label: "Сутки", ms: DAY_MS },
  { id: "week", label: "Неделя", ms: 7 * DAY_MS },
  { id: "month", label: "Месяц", ms: 30 * DAY_MS },
] as const;

/**
 * Сеть глазами владельца: сравнение залов, прибыльность машин, часы пик
 * и взаимозачёт при общем кошельке.
 */
export function NetworkScreen({ clubs }: { clubs: Club[] }) {
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("day");
  const [summary, setSummary] = useState<ClubSummary[]>([]);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [focusClubId, setFocusClubId] = useState<string>(clubs[0]?.id ?? "");
  const [computers, setComputers] = useState<ComputerPerformance[]>([]);
  const [hours, setHours] = useState<HourlyPoint[]>([]);

  const range = RANGES.find((r) => r.id === rangeId)!;

  const load = useCallback(async () => {
    const from = new Date(Date.now() - range.ms).toISOString();
    const period = { from };

    const [nextSummary, nextSettlement] = await Promise.all([
      api.networkReport(period),
      api.settlement(period).catch(() => null),
    ]);
    setSummary(nextSummary);
    setSettlement(nextSettlement);

    if (focusClubId) {
      const [nextComputers, nextHours] = await Promise.all([
        api.computerReport(focusClubId, period),
        api.hoursReport(focusClubId, period),
      ]);
      setComputers(nextComputers);
      setHours(nextHours);
    }
  }, [focusClubId, range.ms]);

  useEffect(() => {
    void load();
  }, [load]);

  const networkRevenue = summary.reduce((sum, c) => sum + c.revenue, 0);
  const peak = hours.reduce((best, h) => (h.revenue > best.revenue ? h : best), {
    hour: 0,
    revenue: 0,
    sessions: 0,
  });
  const maxHourRevenue = Math.max(1, ...hours.map((h) => h.revenue));

  return (
    <main>
      <div className="link-tabs" style={{ marginBottom: 16 }}>
        {RANGES.map((item) => (
          <button
            key={item.id}
            aria-current={rangeId === item.id}
            onClick={() => setRangeId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="summary">
        <div className="stat">
          <div className="value">{formatMoney(networkRevenue)}</div>
          <div className="label">Выручка сети за период</div>
        </div>
        <div className="stat">
          <div className="value">{summary.length}</div>
          <div className="label">Залов в сети</div>
        </div>
        <div className="stat">
          <div className="value">{summary.reduce((sum, c) => sum + c.sessionsCount, 0)}</div>
          <div className="label">Сессий за период</div>
        </div>
      </div>

      <section className="zone-block">
        <div className="zone-head">
          <h2>Залы</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Зал</th>
                <th>Выручка</th>
                <th>Время</th>
                <th>Бар</th>
                <th>Маржа бара</th>
                <th>Загрузка</th>
                <th>Машин</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((club) => (
                <tr key={club.clubId}>
                  <td>{club.clubName}</td>
                  <td className="num">{formatMoney(club.revenue)}</td>
                  <td className="num">{formatMoney(club.sessionsRevenue)}</td>
                  <td className="num">{formatMoney(club.productsRevenue)}</td>
                  <td className="num">{formatMoney(club.productsMargin)}</td>
                  <td className="num">{Math.round(club.occupancy * 100)}%</td>
                  <td className="num">{club.computers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {settlement && settlement.sharedBalance && (
        <section className="zone-block">
          <div className="zone-head">
            <h2>Взаимозачёт между залами</h2>
          </div>
          {/* Общий кошелёк разводит место оплаты и место расхода: без этой
              таблицы сводная выручка сойдётся, а по залам — нет. */}
          <div className="notice">
            Гость пополняет счёт в одном зале, а играет в другом. Отрицательный баланс — зал
            заработал больше, чем принял денег, и сеть должна ему.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Зал</th>
                  <th>Принято в кассу</th>
                  <th>Отыграно здесь</th>
                  <th>Баланс</th>
                </tr>
              </thead>
              <tbody>
                {settlement.rows.map((row) => (
                  <tr key={row.clubId}>
                    <td>{row.clubName}</td>
                    <td className="num">{formatMoney(row.collected)}</td>
                    <td className="num">{formatMoney(row.consumed)}</td>
                    <td className="num" style={{ color: row.balance < 0 ? "var(--in-use)" : "var(--credit)" }}>
                      {formatMoney(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="notice">
            На счетах гостей за период прибавилось {formatMoney(settlement.guestFundsChange)} — это
            оплаченное, но ещё не отыгранное время. Обязательство сети, а не расхождение учёта.
          </div>
        </section>
      )}

      <section className="zone-block">
        <div className="zone-head">
          <h2>Зал по машинам</h2>
          <select
            style={{ width: 260 }}
            value={focusClubId}
            onChange={(e) => setFocusClubId(e.target.value)}
          >
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </div>

        {hours.length > 0 && (
          <>
            <div className="notice">
              Пик — {String(peak.hour).padStart(2, "0")}:00, выручка {formatMoney(peak.revenue)}.
            </div>
            {/* Простая гистограмма по часам: 24 столбца, включая мёртвые часы. */}
            <div className="hours">
              {hours.map((point) => (
                <div className="hour" key={point.hour} title={`${point.hour}:00 — ${formatMoney(point.revenue)}`}>
                  <div
                    className="bar"
                    style={{ height: `${Math.round((point.revenue / maxHourRevenue) * 100)}%` }}
                  />
                  <span className="hour-label">{point.hour}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ПК</th>
                <th>Зона</th>
                <th>Выручка</th>
                <th>Загрузка</th>
                <th>За час занятости</th>
                <th>Сессий</th>
              </tr>
            </thead>
            <tbody>
              {computers.slice(0, 20).map((pc) => (
                <tr key={pc.computerId}>
                  <td>{pc.computerName}</td>
                  <td>{pc.zoneName}</td>
                  <td className="num">{formatMoney(pc.revenue)}</td>
                  <td className="num">{Math.round(pc.occupancy * 100)}%</td>
                  <td className="num">{formatMoney(pc.revenuePerBusyHour)}</td>
                  <td className="num">{pc.sessions}</td>
                </tr>
              ))}
              {computers.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    За период сессий не было
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
