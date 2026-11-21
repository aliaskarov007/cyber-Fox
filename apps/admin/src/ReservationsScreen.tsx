import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type Club,
  type HallCell,
  type Reservation,
  type Zone,
  api,
  formatMoney,
  toTiyn,
} from "./api.js";

const STATUS_LABEL: Record<string, string> = {
  BOOKED: "бронь",
  ARRIVED: "пришёл",
  CANCELLED: "отменена",
  NO_SHOW: "не пришёл",
};

function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-KZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * «Бронь» — брони зала на день. Внутри зоны кассир бронирует всю зону,
 * конкретные ПК (в т.ч. диапазон №20–23) или просто количество ПК без номеров;
 * несколько ПК одной зоны можно забронировать на разные имена. Система считает
 * вместимость зоны на время и не даёт забронировать больше, чем свободно.
 */
export function ReservationsScreen({ club }: { club: Club }) {
  const [day, setDay] = useState(todayKey());
  const [list, setList] = useState<Reservation[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [hall, setHall] = useState<HallCell[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadDay = useCallback(async () => {
    const from = new Date(`${day}T00:00:00`).toISOString();
    const to = new Date(`${day}T00:00:00`);
    to.setDate(to.getDate() + 1);
    setList(await api.reservations(club.id, from, to.toISOString()));
  }, [club.id, day]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useEffect(() => {
    void api.zones(club.id).then(setZones);
    void api.hall(club.id).then(setHall);
  }, [club.id]);

  async function setStatus(id: string, status: string): Promise<void> {
    setError(null);
    try {
      await api.setReservationStatus(club.id, id, status);
      await loadDay();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <main>
      <div className="an-head">
        <h2>Бронь</h2>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value || todayKey())}
        />
      </div>

      {error && <div className="error">{error}</div>}

      <NewReservation
        club={club}
        day={day}
        zones={zones}
        hall={hall}
        onCreated={() => void loadDay()}
      />

      <section className="an-card">
        <div className="an-title">
          Брони на {day.split("-").reverse().join(".")}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Ресурс</th>
                <th>Гость</th>
                <th>Телефон</th>
                <th>Предоплата</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr
                  key={r.id}
                  className={r.status === "CANCELLED" ? "muted" : ""}
                >
                  <td>
                    {hhmm(r.startsAt)}–{hhmm(r.endsAt)}
                  </td>
                  <td>{r.resource}</td>
                  <td>{r.guestName}</td>
                  <td>{r.guestPhone ?? "—"}</td>
                  <td className="num">
                    {r.prepaid > 0 ? formatMoney(r.prepaid) : "—"}
                  </td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="actions">
                    {r.status === "BOOKED" && (
                      <>
                        <button onClick={() => void setStatus(r.id, "ARRIVED")}>
                          Пришёл
                        </button>
                        <button onClick={() => void setStatus(r.id, "NO_SHOW")}>
                          Не пришёл
                        </button>
                        <button
                          onClick={() => void setStatus(r.id, "CANCELLED")}
                        >
                          Отмена
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7}>На этот день броней нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

type ResMode = "whole" | "pick" | "count";

function NewReservation({
  club,
  day,
  zones,
  hall,
  onCreated,
}: {
  club: Club;
  day: string;
  zones: Zone[];
  hall: HallCell[];
  onCreated: () => void;
}) {
  const [zoneId, setZoneId] = useState("");
  const [mode, setMode] = useState<ResMode>("whole");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [count, setCount] = useState("1");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [prepaid, setPrepaid] = useState("");
  const [prepaidMethod, setPrepaidMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ПК выбранной зоны, по возрастанию номера.
  const zonePcs = useMemo(
    () =>
      [...hall]
        .map((c) => c.computer)
        .filter((c) => c.zone.id === zoneId)
        .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })),
    [hall, zoneId],
  );

  // Смена зоны обнуляет выбор ПК и количество — они относятся к прежней зоне.
  function changeZone(id: string): void {
    setZoneId(id);
    setPicked(new Set());
    setRangeFrom("");
    setRangeTo("");
    setCount("1");
  }

  function togglePc(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Отметить диапазон по номерам ПК: VIP №20–23. Имена-числа попадают в выбор.
  function markRange(): void {
    const a = Number(rangeFrom);
    const b = Number(rangeTo);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of zonePcs) {
        const v = Number(c.name);
        if (Number.isFinite(v) && v >= lo && v <= hi) next.add(c.id);
      }
      return next;
    });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!zoneId) {
      setError("Выберите зону");
      return;
    }
    if (mode === "pick" && picked.size === 0) {
      setError("Отметьте хотя бы один ПК");
      return;
    }
    if (mode === "count") {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1) {
        setError("Укажите количество ПК");
        return;
      }
      if (n > zonePcs.length) {
        setError(`В зоне всего ${zonePcs.length} ПК`);
        return;
      }
    }
    if (!guestName.trim()) {
      setError("Укажите гостя");
      return;
    }
    const startsAt = new Date(`${day}T${start}`);
    const endsAt = new Date(`${day}T${end}`);
    if (endsAt <= startsAt) {
      setError("Конец должен быть позже начала");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sum = prepaid.trim() === "" ? 0 : toTiyn(prepaid);
      await api.createReservation(club.id, {
        zoneId,
        ...(mode === "pick" ? { computerIds: [...picked] } : {}),
        ...(mode === "count" ? { quantity: Number(count) } : {}),
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        prepaid: sum,
        prepaidMethod: sum > 0 && prepaidMethod ? prepaidMethod : undefined,
        note: note.trim() || undefined,
      });
      // Имя и ПК сбрасываем — следующий гость, та же зона и время остаются.
      setGuestName("");
      setGuestPhone("");
      setPrepaid("");
      setPrepaidMethod("");
      setNote("");
      setPicked(new Set());
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="an-card res-form" onSubmit={submit}>
      <div className="an-title">Новая бронь</div>
      {error && <div className="error">{error}</div>}

      <div className="res-grid">
        <label>
          Зона
          <select value={zoneId} onChange={(e) => changeZone(e.target.value)}>
            <option value="">— выбрать —</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <TimeField label="С" value={start} onChange={setStart} />
        <TimeField label="До" value={end} onChange={setEnd} />
        <label>
          Гость
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Имя"
          />
        </label>
        <label>
          Телефон
          <input
            value={guestPhone}
            onChange={(e) => setGuestPhone(e.target.value)}
            placeholder="+7…"
          />
        </label>
        <label>
          Предоплата, ₸
          <input
            inputMode="decimal"
            value={prepaid}
            onChange={(e) => setPrepaid(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          Способ предоплаты
          <select
            value={prepaidMethod}
            onChange={(e) => setPrepaidMethod(e.target.value)}
          >
            <option value="">—</option>
            <option value="CASH">Наличные</option>
            <option value="CARD">Карта</option>
            <option value="ONLINE">Онлайн</option>
          </select>
        </label>
        <label className="res-note">
          Заметка
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {/* Что бронируем внутри зоны: всю зону, конкретные ПК или количество. */}
      {zoneId && (
        <div className="res-mode">
          <div className="seg">
            <button
              type="button"
              className={mode === "whole" ? "on" : ""}
              onClick={() => setMode("whole")}
            >
              Вся зона
            </button>
            <button
              type="button"
              className={mode === "pick" ? "on" : ""}
              onClick={() => setMode("pick")}
            >
              Выбрать ПК
            </button>
            <button
              type="button"
              className={mode === "count" ? "on" : ""}
              onClick={() => setMode("count")}
            >
              Количество
            </button>
          </div>

          {mode === "whole" && (
            <div className="res-hint">
              Бронируется вся зона ({zonePcs.length} ПК).
            </div>
          )}

          {mode === "pick" && (
            <div className="res-pick">
              <div className="res-range">
                <span>Диапазон №</span>
                <input
                  inputMode="numeric"
                  value={rangeFrom}
                  placeholder="с"
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
                <span>–</span>
                <input
                  inputMode="numeric"
                  value={rangeTo}
                  placeholder="по"
                  onChange={(e) => setRangeTo(e.target.value)}
                />
                <button type="button" onClick={markRange}>
                  Отметить
                </button>
                {picked.size > 0 && (
                  <button type="button" onClick={() => setPicked(new Set())}>
                    Сбросить
                  </button>
                )}
              </div>
              <div className="res-pcs">
                {zonePcs.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`res-pc ${picked.has(c.id) ? "on" : ""}`}
                    onClick={() => togglePc(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
                {zonePcs.length === 0 && (
                  <span className="res-hint">В этой зоне нет ПК.</span>
                )}
              </div>
              {picked.size > 0 && (
                <div className="res-hint">Выбрано ПК: {picked.size}.</div>
              )}
            </div>
          )}

          {mode === "count" && (
            <label className="res-count">
              Сколько ПК в зоне (любые)
              <input
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
              <small className="res-hint">
                Без указания номеров. В зоне {zonePcs.length} ПК.
              </small>
            </label>
          )}
        </div>
      )}

      <button className="primary" type="submit" disabled={busy}>
        Забронировать
      </button>
    </form>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

/**
 * Выбор времени в 24-часовом виде (часы + минуты). Заменяет <input type="time">,
 * который в некоторых браузерах показывает AM/PM по локали ПК и путает.
 */
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [h, m] = value.split(":");
  const hour = h ?? "00";
  const minute = m ?? "00";
  return (
    <label>
      {label}
      <div className="time-field">
        <select
          value={hour}
          onChange={(e) => onChange(`${e.target.value}:${minute}`)}
          aria-label={`${label} — часы`}
        >
          {HOURS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <span>:</span>
        <select
          value={minute}
          onChange={(e) => onChange(`${hour}:${e.target.value}`)}
          aria-label={`${label} — минуты`}
        >
          {MINUTES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}
