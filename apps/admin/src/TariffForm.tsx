import { type FormEvent, useState } from "react";

import { type Club, type Tariff, type TariffInput, type Zone, api, formatMoney, toTiyn } from "./api.js";
import { hhmm, toMinuteOfDay } from "./tariff-window.js";

/** Создание и правка тарифа. Пустое `editing` означает новый тариф. */
export function TariffForm({
  club,
  zones,
  tariffs,
  editing,
  onClose,
  onSaved,
}: {
  club: Club;
  zones: Zone[];
  tariffs: Tariff[];
  editing: Tariff | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [zoneId, setZoneId] = useState(editing?.zoneId ?? zones[0]?.id ?? "");
  const [kind, setKind] = useState<"PACKAGE" | "PER_MINUTE">(editing?.kind ?? "PER_MINUTE");
  const [pricePerMinute, setPricePerMinute] = useState(money(editing?.pricePerMinute));
  const [packageMinutes, setPackageMinutes] = useState(count(editing?.packageMinutes));
  const [packagePrice, setPackagePrice] = useState(money(editing?.packagePrice));
  const [validityDays, setValidityDays] = useState(count(editing?.validityDays));
  const [activeFrom, setActiveFrom] = useState(time(editing?.activeFromMinute));
  const [activeTo, setActiveTo] = useState(time(editing?.activeToMinute));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Цену минуты выше кредитного лимита сервер отклоняет, но в форме об этом
   * полезнее знать заранее: цену набирают на глаз, а её связь с лимитом долга
   * неочевидна.
   */
  const minutePrice = kind === "PER_MINUTE" && pricePerMinute ? toTiyn(pricePerMinute) : 0;
  const overCredit = minutePrice > club.creditLimit;

  /** Тариф той же зоны с тем же окном — обычная причина «почему считается не тот». */
  const sameWindow = tariffs.some(
    (other) =>
      other.id !== editing?.id &&
      other.zoneId === zoneId &&
      other.kind === kind &&
      other.isActive &&
      (other.activeFromMinute === null) === (activeFrom.trim() === ""),
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const body = buildBody();
      if (editing) {
        await api.updateTariff(club.id, editing.id, body);
        onSaved(`Тариф «${body.name}» сохранён`);
      } else {
        await api.createTariff(club.id, body);
        onSaved(`Тариф «${body.name}» добавлен`);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /*
   * Поля другого вида тарифа обнуляются явно. Иначе у поминутного тарифа, бывшего
   * когда-то пакетом, в базе остались бы минуты и цена пакета: биллинг их не
   * читает, а вот касса показала бы тариф пакетом.
   */
  function buildBody(): TariffInput {
    const body: TariffInput = { name: name.trim(), zoneId, kind };

    if (kind === "PER_MINUTE") {
      body.pricePerMinute = toTiyn(pricePerMinute);
      body.packageMinutes = null;
      body.packagePrice = null;
      body.validityDays = null;
    } else {
      body.packageMinutes = Number(packageMinutes);
      body.packagePrice = toTiyn(packagePrice);
      body.validityDays = validityDays.trim() === "" ? null : Number(validityDays);
      body.pricePerMinute = null;
    }

    const from = toMinuteOfDay(activeFrom);
    const to = toMinuteOfDay(activeTo);
    if (activeFrom.trim() !== "" && from === undefined) throw new Error("Начало окна: формат ЧЧ:ММ");
    if (activeTo.trim() !== "" && to === undefined) throw new Error("Конец окна: формат ЧЧ:ММ");
    if ((from === undefined) !== (to === undefined)) {
      throw new Error("Окно действия задаётся началом и концом сразу");
    }
    body.activeFromMinute = from ?? null;
    body.activeToMinute = to ?? null;

    return body;
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      <label>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ночь, Стандарт" />
      </label>

      <label>
        Зона
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Вид
        <select value={kind} onChange={(e) => setKind(e.target.value as "PACKAGE" | "PER_MINUTE")}>
          <option value="PER_MINUTE">Поминутно</option>
          <option value="PACKAGE">Пакет минут</option>
        </select>
      </label>

      {kind === "PER_MINUTE" ? (
        <label>
          Цена минуты, ₸
          <input
            inputMode="decimal"
            value={pricePerMinute}
            onChange={(e) => setPricePerMinute(e.target.value)}
          />
        </label>
      ) : (
        <>
          <label>
            Минут в пакете
            <input
              inputMode="numeric"
              value={packageMinutes}
              onChange={(e) => setPackageMinutes(e.target.value)}
            />
          </label>
          <label>
            Цена пакета, ₸
            <input
              inputMode="decimal"
              value={packagePrice}
              onChange={(e) => setPackagePrice(e.target.value)}
            />
          </label>
          <label>
            Живёт дней (пусто — {club.packageValidityDays} из настроек зала)
            <input
              inputMode="numeric"
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
            />
          </label>
        </>
      )}

      <label>
        Действует с (пусто — круглосуточно)
        <input value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} placeholder="22:00" />
      </label>

      <label>
        Действует до
        <input value={activeTo} onChange={(e) => setActiveTo(e.target.value)} placeholder="08:00" />
      </label>

      {overCredit && (
        <div className="error">
          Цена минуты больше лимита игры в долг ({formatMoney(club.creditLimit)}): гость не сможет
          доиграть ни минуты в долг. Поднимите лимит зала или снизьте цену.
        </div>
      )}

      {sameWindow && (
        <div className="notice">
          В этой зоне уже есть такой же тариф с тем же временем действия. Если оба останутся
          включёнными, будет непонятно, по какому считается гость.
        </div>
      )}

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {editing ? "Сохранить" : "Добавить"}
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/** Тиын из базы → строка в тенге для поля ввода. */
function money(tiyn: number | null | undefined): string {
  return tiyn === null || tiyn === undefined ? "" : String(tiyn / 100);
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function time(minute: number | null | undefined): string {
  return minute === null || minute === undefined ? "" : hhmm(minute);
}
