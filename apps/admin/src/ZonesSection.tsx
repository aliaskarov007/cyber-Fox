import { type FormEvent, useEffect, useState } from "react";

import { type Club, type Tariff, type Zone, api } from "./api.js";

/**
 * Зоны зала: VIP, стандарт, PlayStation.
 *
 * Зона — не украшение карты: к ней привязаны тарифы, к ней же относятся минуты
 * купленного пакета. Поэтому зоны заводятся раньше машин и тарифов, а не после.
 */
export function ZonesSection({ club, onChanged }: { club: Club; onChanged: () => void }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [nextZones, nextTariffs] = await Promise.all([api.zones(club.id), api.tariffs(club.id)]);
    setZones(nextZones);
    setTariffs(nextTariffs);
  }

  useEffect(() => {
    void load();
  }, [club.id]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === "") return;
    await run(async () => {
      await api.createZone(club.id, { name: name.trim(), sortOrder: zones.length });
      setName("");
    });
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Зоны зала</h2>
        <span className="count">{zones.length}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Зона</th>
              <th>Тариф при исчерпании пакета</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <ZoneRow
                key={zone.id}
                club={club}
                zone={zone}
                tariffs={tariffs.filter((t) => t.zoneId === zone.id && t.kind === "PER_MINUTE")}
                busy={busy}
                onRun={run}
              />
            ))}
            {zones.length === 0 && (
              <tr>
                <td colSpan={3}>
                  Зон нет. Без зоны нельзя завести ни машину, ни тариф — начните с неё.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="settings-grid" onSubmit={create}>
        <label>
          Новая зона
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VIP" />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Добавить зону
        </button>
      </form>
    </section>
  );
}

function ZoneRow({
  club,
  zone,
  tariffs,
  busy,
  onRun,
}: {
  club: Club;
  zone: Zone;
  tariffs: Tariff[];
  busy: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(zone.name);

  useEffect(() => {
    setName(zone.name);
  }, [zone.name]);

  const renamed = name.trim() !== "" && name.trim() !== zone.name;

  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td>
        {/*
         * Этот тариф подхватывается, когда у гостя кончились минуты пакета.
         * Без него сессия на исчерпанном пакете прервалась бы посреди игры.
         */}
        <select
          value={zone.defaultPerMinuteTariffId ?? ""}
          disabled={busy || tariffs.length === 0}
          onChange={(e) =>
            void onRun(() =>
              api.updateZone(club.id, zone.id, { defaultPerMinuteTariffId: e.target.value }),
            )
          }
        >
          <option value="" disabled>
            {tariffs.length === 0 ? "нет поминутных тарифов" : "не выбран"}
          </option>
          {tariffs.map((tariff) => (
            <option key={tariff.id} value={tariff.id}>
              {tariff.name}
            </option>
          ))}
        </select>
      </td>
      <td className="actions">
        <button
          type="button"
          disabled={busy || !renamed}
          onClick={() => void onRun(() => api.updateZone(club.id, zone.id, { name: name.trim() }))}
        >
          Переименовать
        </button>
      </td>
    </tr>
  );
}
