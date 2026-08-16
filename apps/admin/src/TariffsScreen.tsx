import { useEffect, useState } from "react";

import { type Club, type Tariff, type Zone, api, formatMoney } from "./api.js";

function formatWindow(tariff: Tariff): string {
  if (tariff.activeFromMinute === null || tariff.activeToMinute === null) return "круглосуточно";
  const hhmm = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(tariff.activeFromMinute)}–${hhmm(tariff.activeToMinute)}`;
}

export function TariffsScreen({ club }: { club: Club }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    void api.tariffs(club.id).then(setTariffs);
    void api.zones(club.id).then(setZones);
  }, [club.id]);

  const zoneName = (id: string): string => zones.find((z) => z.id === id)?.name ?? "—";

  return (
    <main>
      <div className="summary">
        <div className="stat">
          <div className="value">{formatMoney(club.creditLimit)}</div>
          <div className="label">Лимит игры в долг</div>
        </div>
        <div className="stat">
          <div className="value">{club.packageValidityDays}</div>
          <div className="label">Дней живёт пакет</div>
        </div>
        <div className="stat">
          <div className="value">{club.lowBalanceWarnMinutes}</div>
          <div className="label">Минут до предупреждения</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Тариф</th>
              <th>Зона</th>
              <th>Вид</th>
              <th>Цена</th>
              <th>Действует</th>
            </tr>
          </thead>
          <tbody>
            {tariffs.map((tariff) => (
              <tr key={tariff.id}>
                <td>{tariff.name}</td>
                <td>{zoneName(tariff.zoneId)}</td>
                <td>{tariff.kind === "PACKAGE" ? "Пакет" : "Поминутно"}</td>
                <td className="num">
                  {tariff.kind === "PACKAGE"
                    ? `${formatMoney(tariff.packagePrice ?? 0)} за ${tariff.packageMinutes} мин`
                    : `${formatMoney(tariff.pricePerMinute ?? 0)}/мин`}
                </td>
                <td className="num">{formatWindow(tariff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
