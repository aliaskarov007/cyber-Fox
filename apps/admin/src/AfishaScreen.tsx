import { type FormEvent, useEffect, useState } from "react";

import {
  type Club,
  type ClubEvent,
  type ClubEventInput,
  type EventInvite,
  type InviteAudience,
  type InviteStatus,
  type InviteSummary,
  type Tenant,
  api,
} from "./api.js";

/**
 * Афиша сети: турниры и события, которые видят гости на экранах блокировки
 * всех ПК. Изменение доходит до машин сразу — перезапускать агентов не нужно.
 *
 * Ивент показывается, пока не начался, и ещё четыре часа после начала. Снятый
 * с публикации остаётся в списке, но на экраны не попадает.
 */
export function AfishaScreen({ clubs, isOwner }: { clubs: Club[]; isOwner: boolean }) {
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [invites, setInvites] = useState<Record<string, InviteSummary>>({});
  const [listFor, setListFor] = useState<ClubEvent | null>(null);
  const [editing, setEditing] = useState<ClubEvent | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [nextEvents, nextInvites] = await Promise.all([
        api.events(),
        // Сводка приглашений не должна прятать афишу, если WhatsApp ещё не подключали.
        api.inviteSummaries().catch(() => ({})),
      ]);
      setEvents(nextEvents);
      setInvites(nextInvites);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Пока рассылка идёт, цифры меняются сами: обновляем, не дёргая администратора.
  const sending = Object.values(invites).some((s) => s.pending > 0);
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [sending]);

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
                  <th>WhatsApp</th>
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
                      <td className="num">
                        <InviteCell stats={invites[event.id]} />
                      </td>
                      <td>
                        <div className="actions">
                          {!past && event.isPublished && new Date(event.startsAt).getTime() > now && (
                            <InviteButton
                              event={event}
                              hasClub={event.clubId !== null}
                              invited={(invites[event.id]?.total ?? 0) > 0}
                              onSent={(text) => {
                                setMessage(text);
                                void load();
                              }}
                              onError={setError}
                            />
                          )}
                          {(invites[event.id]?.total ?? 0) > 0 && (
                            <button onClick={() => setListFor(listFor?.id === event.id ? null : event)}>
                              Кто придёт
                            </button>
                          )}
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

      {listFor && <InviteList event={listFor} />}
    </main>
  );
}

const STATUS_LABEL: Record<InviteStatus, string> = {
  GOING: "Придёт",
  DECLINED: "Не сможет",
  SENT: "Без ответа",
  PENDING: "В очереди",
  FAILED: "Не доставлено",
};

const STATUS_ORDER: Record<InviteStatus, number> = { GOING: 0, DECLINED: 1, SENT: 2, PENDING: 3, FAILED: 4 };

function InviteCell({ stats }: { stats: InviteSummary | undefined }) {
  if (!stats || stats.total === 0) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <>
      придут {stats.going} · не смогут {stats.declined}
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        отправлено {stats.sent + stats.going + stats.declined} из {stats.total}
        {stats.pending > 0 && ` · в очереди ${stats.pending}`}
        {stats.failed > 0 && ` · ошибок ${stats.failed}`}
      </div>
    </>
  );
}

/**
 * Рассылка приглашений в WhatsApp. Число получателей показывается до
 * нажатия: рассылку по всей сети не отзовёшь.
 */
function InviteButton({
  event,
  hasClub,
  invited,
  onSent,
  onError,
}: {
  event: ClubEvent;
  hasClub: boolean;
  invited: boolean;
  onSent: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function send(audience: InviteAudience): Promise<void> {
    setBusy(true);
    try {
      const size = await api.eventAudience(event.id, audience);
      const who = audience === "CLUB" ? "гостям этого зала" : "гостям всей сети";
      const hint =
        size.unverified > 0
          ? `\n\nЕщё ${size.unverified} подписанных гостей не получат приглашение: номер не подтверждён.`
          : "";
      if (size.guests === 0) {
        onError(`Некого приглашать: нет ${who} с согласием и подтверждённым номером, или им уже писали дважды за месяц.`);
        return;
      }
      if (!window.confirm(`Разослать «${event.title}» ${who} — ${size.guests} чел.?${hint}`)) return;
      const { queued } = await api.sendInvites(event.id, audience);
      onSent(
        queued > 0
          ? `Приглашения в очереди: ${queued}. Уходят по одному с паузой — это пара минут.`
          : "Новых получателей нет: все, кого можно пригласить, уже приглашены.",
      );
    } catch (cause) {
      onError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="primary" disabled={busy} onClick={() => void send("NETWORK")}>
        {invited ? "Дослать новым" : "Пригласить сеть"}
      </button>
      {hasClub && (
        <button disabled={busy} onClick={() => void send("CLUB")}>
          Только гостей зала
        </button>
      )}
    </>
  );
}

/** Приглашённые и их ответы: сверху те, кто придёт, — список открывают на стойке. */
function InviteList({ event }: { event: ClubEvent }) {
  const [invites, setInvites] = useState<EventInvite[] | null>(null);

  useEffect(() => {
    setInvites(null);
    void api
      .eventInvites(event.id)
      .then((list) => setInvites([...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])));
  }, [event.id]);

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Приглашённые на «{event.title}»</h2>
        {invites && (
          <span className="chip in-use">придут: {invites.filter((i) => i.status === "GOING").length}</span>
        )}
      </div>
      {invites === null ? (
        <div className="notice">Загружаем…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Гость</th>
                <th>Телефон</th>
                <th>Ответ</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.guest.fullName}</td>
                  <td className="num">{invite.guest.phone}</td>
                  <td>
                    {STATUS_LABEL[invite.status]}
                    {invite.status === "FAILED" && invite.error ? ` — ${invite.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
