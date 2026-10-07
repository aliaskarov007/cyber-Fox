import { useEffect, useState } from "react";

import type { AfishaEvent } from "./agent-client.js";
import { eventDay, eventWhen } from "./afisha-format.js";

/** Сколько висит одна афиша, прежде чем смениться следующей. */
const ROTATE_MS = 10_000;

/**
 * Окно афиши справа от входа: ближайшие ивенты сети по кругу.
 *
 * Полоска внизу — не украшение: она заполняется ровно за время показа и
 * говорит, когда сменится афиша. Пока ивентов нет, окно не пустует, а зовёт
 * подписаться на приглашения — это и есть путь узнать о следующем турнире.
 */
export function Poster({ events, consentBonus }: { events: AfishaEvent[]; consentBonus: number }) {
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (events.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % events.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [events.length]);

  // Афиша могла смениться короче, чем была: не показываем пустое место.
  useEffect(() => {
    if (index >= events.length) setIndex(0);
  }, [events.length, index]);

  // «Идёт сейчас» должно появиться само, без перезапуска агента.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const event = events[Math.min(index, events.length - 1)];

  if (!event) {
    return (
      <aside className="win poster empty">
        <div className="art">
          <div className="kind">Турниры и события клуба</div>
          <h3>Узнавайте о турнирах первыми</h3>
        </div>
        <p className="how">
          При регистрации подпишитесь на приглашения — пришлём в WhatsApp, когда откроется запись.
          {consentBonus > 0 && ` За подписку — подарок на счёт.`}
        </p>
      </aside>
    );
  }

  const start = new Date(event.startsAt);
  const rows: Array<[string, string, boolean]> = [];
  if (event.prize) rows.push(["Призовой фонд", event.prize, true]);
  if (event.clubName) rows.push(["Где", event.clubName, false]);
  if (event.fee) rows.push(["Взнос", event.fee, false]);
  if (event.seats) rows.push(["Свободно мест", event.seats, false]);

  return (
    <aside className="win poster">
      <div className="art">
        <div className="date" aria-hidden="true">
          {eventDay(start)}
        </div>
        {event.subtitle && <div className="kind">{event.subtitle}</div>}
        <h3>{event.title}</h3>
        <div className="when">{eventWhen(start, now)}</div>
      </div>
      <div className="details">
        {rows.length > 0 && (
          <dl>
            {rows.map(([label, value, prize]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={prize ? "prize" : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {event.howToJoin && <p className="how">{event.howToJoin}</p>}
      </div>
      {events.length > 1 && (
        <div className="rotate">
          <span>
            {index + 1} из {events.length}
          </span>
          {/* Ключ перезапускает заполнение с каждой новой афишей. */}
          <span className="bar">
            <i key={event.id} style={{ animationDuration: `${ROTATE_MS}ms` }} />
          </span>
        </div>
      )}
    </aside>
  );
}
