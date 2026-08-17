import { useEffect, useState } from "react";

import { type Club, type Tariff, type Zone, api, formatMoney } from "./api.js";
import { TariffForm } from "./TariffForm.js";
import { formatWindow } from "./tariff-window.js";

export function TariffsScreen({ club }: { club: Club }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  /** Тариф в правке; null вместе с открытой формой означает новый. */
  const [editing, setEditing] = useState<Tariff | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [nextTariffs, nextZones] = await Promise.all([api.tariffs(club.id), api.zones(club.id)]);
    setTariffs(nextTariffs);
    setZones(nextZones);
  }

  useEffect(() => {
    void load();
  }, [club.id]);

  const zoneName = (id: string): string => zones.find((z) => z.id === id)?.name ?? "—";

  /*
   * Выключение вместо удаления. Тариф связан с оплаченными пакетами и закрытыми
   * сессиями: удалить его — значит потерять, по какой цене гость купил минуты,
   * которые ещё не доиграл.
   */
  async function toggle(tariff: Tariff): Promise<void> {
    setError(null);
    setDone(null);
    try {
      await api.updateTariff(club.id, tariff.id, { isActive: !tariff.isActive });
      await load();
      setDone(tariff.isActive ? `Тариф «${tariff.name}» выключен` : `Тариф «${tariff.name}» включён`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function openForm(tariff: Tariff | null): void {
    setEditing(tariff);
    setFormOpen(true);
  }

  return (
    <main>
      {error && <div className="error">{error}</div>}
      {done && <div className="notice">{done}</div>}

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

      <section className="zone-block">
        <div className="zone-head">
          <h2>Тарифы</h2>
          <button className="primary" type="button" onClick={() => openForm(null)}>
            Добавить тариф
          </button>
        </div>

        {zones.length === 0 && (
          <div className="notice">
            Сначала заведите зону в настройках: тариф всегда принадлежит зоне, иначе непонятно, за
            какие машины он берёт деньги.
          </div>
        )}

        {formOpen && zones.length > 0 && (
          <TariffForm
            /* Ключ пересоздаёт форму при смене правимого тарифа: поля хранятся в
               состоянии и иначе остались бы от прошлого. */
            key={editing?.id ?? "new"}
            club={club}
            zones={zones}
            tariffs={tariffs}
            editing={editing}
            onClose={() => {
              setFormOpen(false);
              setEditing(null);
            }}
            onSaved={(message) => {
              setFormOpen(false);
              setEditing(null);
              setDone(message);
              void load();
            }}
          />
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тариф</th>
                <th>Зона</th>
                <th>Вид</th>
                <th>Цена</th>
                <th>Действует</th>
                <th>Состояние</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tariffs.map((tariff) => (
                <tr key={tariff.id} className={tariff.isActive ? "" : "muted"}>
                  <td>{tariff.name}</td>
                  <td>{zoneName(tariff.zoneId)}</td>
                  <td>{tariff.kind === "PACKAGE" ? "Пакет" : "Поминутно"}</td>
                  <td className="num">
                    {tariff.kind === "PACKAGE"
                      ? `${formatMoney(tariff.packagePrice ?? 0)} за ${tariff.packageMinutes} мин`
                      : `${formatMoney(tariff.pricePerMinute ?? 0)}/мин`}
                  </td>
                  <td className="num">{formatWindow(tariff)}</td>
                  <td>{tariff.isActive ? "работает" : "выключен"}</td>
                  <td className="actions">
                    <button type="button" onClick={() => openForm(tariff)}>
                      Править
                    </button>
                    <button type="button" onClick={() => void toggle(tariff)}>
                      {tariff.isActive ? "Выключить" : "Включить"}
                    </button>
                  </td>
                </tr>
              ))}
              {tariffs.length === 0 && (
                <tr>
                  <td colSpan={7}>Тарифов пока нет. Пока их нет, посадить гостя не получится.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
