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
 * «Бронь» — брони зала на день. Кассир бронирует зону целиком или конкретную
 * машину на время; система не даёт двум броням пересечься по одному ресурсу.
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
  const [resource, setResource] = useState("");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [prepaid, setPrepaid] = useState("");
  const [prepaidMethod, setPrepaidMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computers = useMemo(
    () =>
      [...hall]
        .map((c) => c.computer)
        .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })),
    [hall],
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!resource) {
      setError("Выберите ресурс");
      return;
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
    const [kind, id] = resource.split(":");
    setBusy(true);
    setError(null);
    try {
      const sum = prepaid.trim() === "" ? 0 : toTiyn(prepaid);
      await api.createReservation(club.id, {
        ...(kind === "zone" ? { zoneId: id } : { computerId: id }),
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        prepaid: sum,
        prepaidMethod: sum > 0 && prepaidMethod ? prepaidMethod : undefined,
        note: note.trim() || undefined,
      });
      setGuestName("");
      setGuestPhone("");
      setPrepaid("");
      setPrepaidMethod("");
      setNote("");
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
          Ресурс
          <select
            value={resource}
            onChange={(e) => setResource(e.target.value)}
          >
            <option value="">— выбрать —</option>
            <optgroup label="Зона целиком">
              {zones.map((z) => (
                <option key={z.id} value={`zone:${z.id}`}>
                  {z.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Отдельный ПК">
              {computers.map((c) => (
                <option key={c.id} value={`pc:${c.id}`}>
                  ПК {c.name}
                </option>
              ))}
            </optgroup>
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
