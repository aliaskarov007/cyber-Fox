import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  type Club,
  type ClubEvent,
  type EventAudience,
  type EventInvite,
  type InviteStatus,
  type Staff,
  api,
} from "./api.js";

const STATUS_LABEL: Record<InviteStatus, string> = {
  GOING: "Придёт",
  DECLINED: "Не сможет",
  SENT: "Без ответа",
  PENDING: "В очереди",
  FAILED: "Не доставлено",
};

const STATUS_ORDER: Record<InviteStatus, number> = {
  GOING: 0,
  DECLINED: 1,
  SENT: 2,
  PENDING: 3,
  FAILED: 4,
};

const AUDIENCE_LABEL: Record<EventAudience, string> = {
  NETWORK: "Все гости сети",
  CLUB: "Гости этого зала",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-KZ", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Ивенты зала и приглашения по всей сети через WhatsApp.
 *
 * Гость общий для всех залов, поэтому о турнире в одном филиале узнают и те,
 * кто обычно играет в другом. Ответы «1» и «2» из WhatsApp сами попадают
 * в список записавшихся.
 */
export function EventsScreen({ club, staff }: { club: Club; staff: Staff }) {
  const canManage = staff.role === "OWNER" || staff.role === "ADMIN";
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [whatsappReady, setWhatsappReady] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setEvents(await api.events(club.id));
  }, [club.id]);

  useEffect(() => {
    void load();
    void api
      .whatsapp()
      .then((c) => setWhatsappReady(c.connected))
      .catch(() => setWhatsappReady(null));
  }, [load]);

  // Пока рассылка идёт, цифры меняются сами: обновляем список, не дёргая админа.
  const sending = events.some((e) => (e.invites?.pending ?? 0) > 0);
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [sending, load]);

  async function act(action: () => Promise<string>): Promise<void> {
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <main>
      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      {whatsappReady === false && (
        <div className="notice warn">
          WhatsApp не подключён — приглашения не уйдут. Владелец сети подключает его в «Настройках».
        </div>
      )}

      {canManage && <EventForm club={club} onCreated={() => void load()} />}

      <section className="zone-block">
        <div className="zone-head">
          <h2>Ивенты</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Ивент</th>
                <th>Кому</th>
                <th>Разослано</th>
                <th>Придут</th>
                <th>Не смогут</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const stats = event.invites;
                const past = new Date(event.startsAt).getTime() <= Date.now();
                return (
                  <tr key={event.id} style={event.canceledAt ? { opacity: 0.55 } : undefined}>
                    <td>{formatWhen(event.startsAt)}</td>
                    <td>
                      {event.title}
                      {event.canceledAt && <span className="chip offline"> отменён</span>}
                    </td>
                    <td>{AUDIENCE_LABEL[event.audience]}</td>
                    <td className="num">
                      {stats && stats.total > 0
                        ? `${stats.sent + stats.going + stats.declined} из ${stats.total}`
                        : "—"}
                      {stats && stats.pending > 0 && ` · в очереди ${stats.pending}`}
                      {stats && stats.failed > 0 && ` · ошибок ${stats.failed}`}
                    </td>
                    <td className="num">{stats?.going ?? 0}</td>
                    <td className="num">{stats?.declined ?? 0}</td>
                    <td>
                      <div className="actions">
                        {canManage && !event.canceledAt && !past && (
                          <SendButton
                            club={club}
                            event={event}
                            onSend={() =>
                              act(async () => {
                                const { queued } = await api.sendEvent(club.id, event.id);
                                return queued > 0
                                  ? `Приглашения в очереди: ${queued}. Уходят по одному, с паузой — это займёт пару минут.`
                                  : "Новых получателей нет: все, кого можно пригласить, уже приглашены.";
                              })
                            }
                          />
                        )}
                        <button onClick={() => setOpenId(openId === event.id ? null : event.id)}>
                          Список
                        </button>
                        {canManage && !event.canceledAt && !past && (
                          <button
                            className="danger"
                            onClick={() => {
                              if (!window.confirm(`Отменить «${event.title}»? Неотправленные приглашения не уйдут.`)) return;
                              void act(async () => {
                                await api.cancelEvent(club.id, event.id);
                                return "Ивент отменён";
                              });
                            }}
                          >
                            Отменить
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    Ивентов пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {openId && <InviteList club={club} eventId={openId} />}
    </main>
  );
}

function SendButton({ club, event, onSend }: { club: Club; event: ClubEvent; onSend: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function click(): Promise<void> {
    setBusy(true);
    try {
      // Число получателей — до нажатия: рассылку по всей сети не отзовёшь.
      const size = await api.eventAudience(club.id, event.audience);
      const hint =
        size.unverified > 0
          ? `\n\nЕщё ${size.unverified} гостей не получат приглашение: номер не подтверждён.`
          : "";
      if (!window.confirm(`Разослать приглашение «${event.title}» — ${size.guests} гостям?${hint}`)) return;
      await onSend();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="primary" disabled={busy} onClick={() => void click()}>
      {event.sentAt ? "Дослать новым" : "Разослать"}
    </button>
  );
}

function EventForm({ club, onCreated }: { club: Club; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<EventAudience>("NETWORK");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!startsAt) throw new Error("Укажите дату и время начала");
      await api.createEvent(club.id, {
        title: title.trim(),
        // Поле datetime-local даёт время без пояса — браузер стойки стоит в поясе зала.
        startsAt: new Date(startsAt).toISOString(),
        audience,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setTitle("");
      setStartsAt("");
      setDescription("");
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Новый ивент</h2>
      </div>
      {error && <div className="error">{error}</div>}
      <form className="settings-grid" onSubmit={submit}>
        <label>
          Название
          <input
            value={title}
            maxLength={80}
            placeholder="Турнир по CS2 5×5"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Начало
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label>
          Кого приглашать
          <select value={audience} onChange={(e) => setAudience(e.target.value as EventAudience)}>
            <option value="NETWORK">{AUDIENCE_LABEL.NETWORK}</option>
            <option value="CLUB">{AUDIENCE_LABEL.CLUB}</option>
          </select>
        </label>
        <label className="wide">
          Описание (уйдёт в приглашении)
          <textarea
            rows={3}
            maxLength={600}
            placeholder="Взнос 2 000 ₸ с игрока, призовой фонд 50 000 ₸. Регистрация команд до 19:30."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={busy || title.trim().length < 3}>
          Создать
        </button>
      </form>
    </section>
  );
}

function InviteList({ club, eventId }: { club: Club; eventId: string }) {
  const [invites, setInvites] = useState<EventInvite[] | null>(null);

  useEffect(() => {
    setInvites(null);
    // Сверху — те, кто придёт: этот список открывают на стойке в день ивента.
    void api
      .eventInvites(club.id, eventId)
      .then((list) => setInvites([...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])));
  }, [club.id, eventId]);

  if (!invites) return <div className="notice">Загружаем…</div>;

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Приглашённые</h2>
        <span className="chip in-use">придут: {invites.filter((i) => i.status === "GOING").length}</span>
      </div>
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
                <td title={invite.error ?? undefined}>
                  {STATUS_LABEL[invite.status]}
                  {invite.status === "FAILED" && invite.error ? ` — ${invite.error}` : ""}
                </td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: "var(--muted)" }}>
                  Приглашения ещё не рассылались
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
