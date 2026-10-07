import { type FormEvent, useState } from "react";

import {
  type Club,
  type PackageFormat,
  type Tariff,
  type TariffInput,
  type Zone,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";
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
  const [format, setFormat] = useState<PackageFormat>(editing?.packageFormat ?? "MINUTES");
  const [bonusMinutes, setBonusMinutes] = useState(editing?.bonusMinutes ? String(editing.bonusMinutes) : "");
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

  /**
   * Поминутный тариф той же зоны с тем же окном — обычная причина «почему
   * считается не тот». Пакетов в зоне бывает несколько намеренно: 2+1, ночь,
   * абонемент — для них это не ошибка.
   */
  const sameWindow = kind === "PER_MINUTE" && tariffs.some(
    (other) =>
      other.id !== editing?.id &&
      other.zoneId === zoneId &&
      other.kind === kind &&
      other.isActive &&
      (other.activeFromMinute === null) === (activeFrom.trim() === ""),
  );

  /*
   * Шаблоны частых пакетов. Цену «N+M» подставляем из поминутки зоны — пакет
   * для того и придуман, чтобы платить за N часов. Цену ночного и абонемента
   * владелец задаёт сам: у них нет «честной» цены по минутам.
   */
  function preset(kind: "2+1" | "3+2" | "night" | "subscription"): void {
    const perMinute = tariffs.find(
      (t) => t.zoneId === zoneId && t.kind === "PER_MINUTE" && t.isActive && t.activeFromMinute === null,
    )?.pricePerMinute;
    const priceFor = (minutes: number): string => (perMinute ? String((perMinute * minutes) / 100) : "");

    setKind("PACKAGE");
    setActiveFrom("");
    setActiveTo("");
    if (kind === "2+1" || kind === "3+2") {
      const [paid, bonus] = kind === "2+1" ? [120, 60] : [180, 120];
      setName(kind === "2+1" ? "2+1 часа" : "3+2 часа");
      setFormat("MINUTES");
      setPackageMinutes(String(paid));
      setBonusMinutes(String(bonus));
      setPackagePrice(priceFor(paid));
      setValidityDays("1");
    } else if (kind === "night") {
      setName("Ночь");
      setFormat("NIGHT");
      setPackageMinutes("");
      setBonusMinutes("");
      setPackagePrice("");
      setValidityDays("");
      setActiveFrom("22:00");
      setActiveTo("08:00");
    } else {
      setName("Абонемент 20 часов");
      setFormat("SUBSCRIPTION");
      setPackageMinutes("1200");
      setBonusMinutes("");
      setPackagePrice("");
      setValidityDays("30");
    }
  }

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
      if (packagePrice.trim() === "") throw new Error("Укажите цену пакета");
      body.packageFormat = format;
      body.packagePrice = toTiyn(packagePrice);
      body.pricePerMinute = null;
      if (format === "NIGHT") {
        // Ночной длится до конца окна: ни минут, ни срока в днях у него нет.
        body.packageMinutes = null;
        body.bonusMinutes = 0;
        body.validityDays = null;
        if (activeFrom.trim() === "") throw new Error("Ночному пакету нужно окно: например, с 22:00 до 08:00");
      } else {
        body.packageMinutes = Number(packageMinutes);
        body.bonusMinutes = format === "MINUTES" && bonusMinutes.trim() !== "" ? Number(bonusMinutes) : 0;
        body.validityDays = validityDays.trim() === "" ? null : Number(validityDays);
      }
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

  const label = format === "MINUTES" && bonusMinutes ? hoursLabel(Number(packageMinutes), Number(bonusMinutes)) : null;

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      {!editing && (
        <div className="presets">
          <span>Шаблоны:</span>
          <button type="button" onClick={() => preset("2+1")}>
            2+1
          </button>
          <button type="button" onClick={() => preset("3+2")}>
            3+2
          </button>
          <button type="button" onClick={() => preset("night")}>
            Ночь 22–08
          </button>
          <button type="button" onClick={() => preset("subscription")}>
            Абонемент 20 ч / 30 дней
          </button>
        </div>
      )}

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
            Формат
            <select value={format} onChange={(e) => setFormat(e.target.value as PackageFormat)}>
              <option value="MINUTES">Пакет минут (в том числе 2+1)</option>
              <option value="NIGHT">Ночной — до конца окна</option>
              <option value="SUBSCRIPTION">Абонемент — с переносом остатка</option>
            </select>
          </label>
          {format !== "NIGHT" && (
            <label>
              {format === "MINUTES" ? "Оплаченных минут" : "Минут в абонементе"}
              <input
                inputMode="numeric"
                value={packageMinutes}
                onChange={(e) => setPackageMinutes(e.target.value)}
              />
            </label>
          )}
          {format === "MINUTES" && (
            <label>
              Минут в подарок{label ? ` — пакет «${label}»` : " (пусто — без подарка)"}
              <input
                inputMode="numeric"
                value={bonusMinutes}
                onChange={(e) => setBonusMinutes(e.target.value)}
              />
            </label>
          )}
          <label>
            Цена пакета, ₸
            <input
              inputMode="decimal"
              value={packagePrice}
              onChange={(e) => setPackagePrice(e.target.value)}
            />
          </label>
          {format !== "NIGHT" && (
            <label>
              Живёт дней (пусто — {club.packageValidityDays} из настроек зала)
              <input
                inputMode="numeric"
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
              />
            </label>
          )}
        </>
      )}

      <label>
        {kind === "PACKAGE"
          ? format === "NIGHT"
            ? "Ночь с"
            : "Продаётся с (пусто — круглосуточно)"
          : "Действует с (пусто — круглосуточно)"}
        <input value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} placeholder="22:00" />
      </label>

      <label>
        {kind === "PACKAGE" ? (format === "NIGHT" ? "Ночь до" : "Продаётся до") : "Действует до"}
        <input value={activeTo} onChange={(e) => setActiveTo(e.target.value)} placeholder="08:00" />
      </label>

      {overCredit && (
        <div className="error">
          Цена минуты больше лимита игры в долг ({formatMoney(club.creditLimit)}): гость не сможет
          доиграть ни минуты в долг. Поднимите лимит зала или снизьте цену.
        </div>
      )}

      {kind === "PACKAGE" && format === "NIGHT" && (
        <div className="notice">
          Ночной продаётся только внутри окна и длится ровно до его конца: куплен в 01:00 — играет до
          08:00 за ту же цену. Когда окно кончится, гость автоматически перейдёт на поминутный тариф.
        </div>
      )}

      {kind === "PACKAGE" && format === "SUBSCRIPTION" && (
        <div className="notice">
          Продлил вовремя — часть остатка переезжает в новый абонемент. Процент и сроки продления
          задаются в настройках зала.
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

/** «2+1», «3+2» — как пакет называют на стойке. */
function hoursLabel(paid: number, bonus: number): string | null {
  if (!paid || !bonus) return null;
  const part = (m: number): string => (m % 60 === 0 ? String(m / 60) : `${m} мин`);
  return `${part(paid)}+${part(bonus)}`;
}
