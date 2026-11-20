import { useCallback, useEffect, useState } from "react";

import {
  type Club,
  type ClubSummary,
  type ComputerPerformance,
  type DailyPoint,
  type HourlyPoint,
  api,
  formatMoney,
} from "./api.js";

const PERIODS = [
  { days: 7, label: "7 дней" },
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
];

/**
 * «Аналитика» — взгляд владельца на зал и сеть за период: выручка по дням,
 * загрузка по часам и машинам, сравнение клубов. Касса видит одну смену —
 * этот экран показывает картину во времени.
 */
export function AnalyticsScreen({
  club,
  clubs,
}: {
  club: Club;
  clubs: Club[];
}) {
  const [days, setDays] = useState(30);
  const [network, setNetwork] = useState<ClubSummary[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [hours, setHours] = useState<HourlyPoint[]>([]);
  const [computers, setComputers] = useState<ComputerPerformance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [net, day, hrs, comp] = await Promise.all([
        api.reportNetwork(days),
        api.reportDaily(club.id, days),
        api.reportHours(club.id, days),
        api.reportComputers(club.id, days),
      ]);
      setNetwork(net);
      setDaily(day);
      setHours(hrs);
      setComputers(comp);
    } finally {
      setLoading(false);
    }
  }, [club.id, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = network.find((n) => n.clubId === club.id) ?? null;
  const dailyMax = Math.max(1, ...daily.map((d) => d.revenue));
  const hoursMax = Math.max(1, ...hours.map((h) => h.sessions));
  const avgDaily =
    daily.length > 0
      ? Math.round(daily.reduce((s, d) => s + d.revenue, 0) / daily.length)
      : 0;

  return (
    <main>
      <div className="an-head">
        <h2>Аналитика</h2>
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

      {loading && <div className="notice">Считаем…</div>}

      {mine && (
        <div className="an-tiles">
          <Tile label="Выручка за период" value={formatMoney(mine.revenue)} />
          <Tile label="В среднем в день" value={formatMoney(avgDaily)} />
          <Tile label="Сессий" value={String(mine.sessionsCount)} />
          <Tile
            label="Загрузка машин"
            value={`${Math.round(mine.occupancy * 100)}%`}
          />
          <Tile label="Бар · маржа" value={formatMoney(mine.productsMargin)} />
        </div>
      )}

      <section className="an-card">
        <div className="an-title">Выручка по дням</div>
        <div className="an-bars">
          {daily.map((d) => (
            <div className="an-bar-col" key={d.date} title={`${d.date}`}>
              <div
                className="an-bar"
                style={{ height: `${(d.revenue / dailyMax) * 100}%` }}
                title={`${d.date}: ${formatMoney(d.revenue)}`}
              />
            </div>
          ))}
        </div>
        <div className="an-axis">
          <span>{daily[0]?.date.slice(5)}</span>
          <span>{daily[daily.length - 1]?.date.slice(5)}</span>
        </div>
      </section>

      <section className="an-card">
        <div className="an-title">Загрузка по часам (сессии)</div>
        <div className="an-bars an-hours">
          {hours.map((h) => (
            <div
              className="an-bar-col"
              key={h.hour}
              title={`${h.hour}:00 — ${h.sessions} сессий, ${formatMoney(h.revenue)}`}
            >
              <div
                className="an-bar"
                style={{ height: `${(h.sessions / hoursMax) * 100}%` }}
              />
              {h.hour % 6 === 0 && <span className="an-hlabel">{h.hour}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="an-card">
        <div className="an-title">Машины за период</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Машина</th>
                <th>Зона</th>
                <th>Выручка</th>
                <th>Загрузка</th>
                <th>₸/час занятости</th>
              </tr>
            </thead>
            <tbody>
              {computers.map((c) => (
                <tr key={`${c.zoneName}-${c.computerName}`}>
                  <td>{c.computerName}</td>
                  <td>{c.zoneName}</td>
                  <td className="num">{formatMoney(c.revenue)}</td>
                  <td className="num">{Math.round(c.occupancy * 100)}%</td>
                  <td className="num">{formatMoney(c.revenuePerBusyHour)}</td>
                </tr>
              ))}
              {computers.length === 0 && !loading && (
                <tr>
                  <td colSpan={5}>За период сессий не было.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {clubs.length > 1 && network.length > 1 && (
        <section className="an-card">
          <div className="an-title">Сравнение клубов</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Клуб</th>
                  <th>Выручка</th>
                  <th>Время</th>
                  <th>Бар</th>
                  <th>Сессий</th>
                  <th>Загрузка</th>
                </tr>
              </thead>
              <tbody>
                {[...network]
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((n) => (
                    <tr
                      key={n.clubId}
                      className={n.clubId === club.id ? "" : "muted"}
                    >
                      <td>{n.clubName}</td>
                      <td className="num">{formatMoney(n.revenue)}</td>
                      <td className="num">{formatMoney(n.sessionsRevenue)}</td>
                      <td className="num">{formatMoney(n.productsRevenue)}</td>
                      <td className="num">{n.sessionsCount}</td>
                      <td className="num">{Math.round(n.occupancy * 100)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="an-tile">
      <div className="an-tile-value">{value}</div>
      <div className="an-tile-label">{label}</div>
    </div>
  );
}
