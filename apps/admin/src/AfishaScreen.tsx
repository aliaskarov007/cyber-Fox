import { type FormEvent, useEffect, useState } from "react";

import { type Club, type ClubEvent, type ClubEventInput, type Tenant, api } from "./api.js";

/**
 * Афиша сети: турниры и события, которые видят гости на экранах блокировки
 * всех ПК. Изменение доходит до машин сразу — перезапускать агентов не нужно.
 *
 * Ивент показывается, пока не начался, и ещё четыре часа после начала. Снятый
 * с публикации остаётся в списке, но на экраны не попадает.
 */
export function AfishaScreen({ clubs, isOwner }: { clubs: Club[]; isOwner: boolean }) {
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [editing, setEditing] = useState<ClubEvent | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setEvents(await api.events());
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const clubName = (id: string | null): string =>
    id ? (clubs.find((c) => c.id === id)?.name ?? "—") : "Вся сеть";
  const now = Date.now();

  return (
    <main>
      {isOwner && <SloganSettings onSaved={setMessage} />}

      <section className="zone-block">
        <div className="zone-head">
          <h2>Афиша на экранах ПК</h2>
          {editing === null && (
            <button className="primary" onClick={() => setEditing("new")}>
              Новый ивент
            </button>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {message && <div className="notice">{message}</div>}

        {editing !== null && (
          <EventForm
            clubs={clubs}
            event={editing === "new" ? null : editing}
            onDone={(text) => {
              setEditing(null);
              setMessage(text);
              void load();
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        {events === null ? (
          <div className="notice">Загружаем…</div>
        ) : events.length === 0 ? (
          <div className="notice">
            Ивентов пока нет. Заведите турнир — он появится справа от входа на всех ПК сети.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ивент</th>
                  <th>Когда</th>
                  <th>Где</th>
                  <th>На экранах</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const start = new Date(event.startsAt);
                  const past = start.getTime() + 4 * 3_600_000 < now;
                  return (
                    <tr key={event.id}>
                      <td>
                        {event.title}
                        {event.subtitle && (
                          <div style={{ color: "var(--muted)", fontSize: 13 }}>{event.subtitle}</div>
                        )}
                      </td>
                      <td className="num">{start.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td>{clubName(event.clubId)}</td>
                      <td>
                        <span className={`chip ${event.isPublished && !past ? "in-use" : "idle"}`}>
                          {past ? "прошёл" : event.isPublished ? "показывается" : "снят"}
                        </span>
                      </td>
                      <td>
                        <div className="actions">
                          <button onClick={() => setEditing(event)}>Изменить</button>
                          <button
                            onClick={() => {
                              if (!window.confirm(`Удалить «${event.title}» из афиши?`)) return;
                              void api
                                .deleteEvent(event.id)
                                .then(() => {
                                  setMessage("Ивент удалён");
                                  return load();
                                })
                                .catch((cause: Error) => setError(cause.message));
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

/** Значение для поля «дата и время» в часах кассы. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EventForm({
  clubs,
  event,
  onDone,
  onCancel,
}: {
  clubs: Club[];
  event: ClubEvent | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: event?.title ?? "",
    subtitle: event?.subtitle ?? "",
    startsAt: event ? toLocalInput(event.startsAt) : "",
    clubId: event?.clubId ?? "",
    prize: event?.prize ?? "",
    fee: event?.fee ?? "",
    seats: event?.seats ?? "",
    howToJoin: event?.howToJoin ?? "",
    isPublished: event?.isPublished ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!form.startsAt) throw new Error("Укажите дату и время начала");
      const body: ClubEventInput = {
        ...form,
        clubId: form.clubId === "" ? null : form.clubId,
        startsAt: new Date(form.startsAt).toISOString(),
      };
      if (event) {
        await api.updateEvent(event.id, body);
        onDone("Ивент обновлён — экраны ПК уже показывают новую версию");
      } else {
        await api.createEvent(body);
        onDone(form.isPublished ? "Ивент добавлен в афишу на всех ПК" : "Ивент сохранён, но пока не показывается");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      <label>
        Название
        <input value={form.title} onChange={set("title")} maxLength={60} placeholder="Ночная лига Cyber-Fox" />
      </label>
      <label>
        Что за ивент, одной строкой
        <input
          value={form.subtitle}
          onChange={set("subtitle")}
          maxLength={60}
          placeholder="Турнир CS2, команды 5 на 5"
        />
      </label>
      <label>
        Начало
        <input type="datetime-local" value={form.startsAt} onChange={set("startsAt")} />
      </label>
      <label>
        Где проходит
        <select value={form.clubId} onChange={set("clubId")}>
          <option value="">Вся сеть или онлайн</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Призовой фонд
        <input value={form.prize} onChange={set("prize")} maxLength={24} placeholder="200 000 ₸" />
      </label>
      <label>
        Взнос
        <input value={form.fee} onChange={set("fee")} maxLength={24} placeholder="5 000 ₸ с команды" />
      </label>
      <label>
        Свободно мест
        <input value={form.seats} onChange={set("seats")} maxLength={24} placeholder="4 из 16" />
      </label>
      <label>
        Как записаться
        <input
          value={form.howToJoin}
          onChange={set("howToJoin")}
          maxLength={90}
          placeholder="Записать команду можно у администратора любого филиала."
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={form.isPublished}
          onChange={(e) => setForm((f) => ({ ...f, isPublished: e.target.checked }))}
        />
        Показывать на экранах ПК
      </label>

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {event ? "Сохранить" : "Добавить в афишу"}
        </button>
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/** Подпись под названием сети на экранах ПК. Меняет только владелец. */
function SloganSettings({ onSaved }: { onSaved: (message: string) => void }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [slogan, setSlogan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .tenant()
      .then((t) => {
        setTenant(t);
        setSlogan(t.slogan);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateTenant({ slogan: slogan.trim() });
      onSaved("Лозунг обновлён на всех экранах ПК");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!tenant) return error ? <div className="error">{error}</div> : null;

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Подпись на экранах ПК</h2>
      </div>
      {error && <div className="error">{error}</div>}
      <form className="settings-grid" onSubmit={submit}>
        <label>
          Лозунг под названием «{tenant.name}»
          <input value={slogan} onChange={(e) => setSlogan(e.target.value)} maxLength={48} />
        </label>
        <button className="primary" type="submit" disabled={busy || slogan.trim().length < 2}>
          Сохранить
        </button>
      </form>
    </section>
  );
}
