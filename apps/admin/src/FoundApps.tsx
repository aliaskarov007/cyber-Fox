import { useState } from "react";

import { type AppSuggestion, type Club, api } from "./api.js";

/**
 * Найденное на машинах зала.
 *
 * Агент при подключении рассказывает, что на машине установлено. Владелец
 * отмечает нужное и ставит на полки одним нажатием — заводить сорок игр руками
 * никто не станет. Отбор нужен потому, что на машинах стоит и то, что гостю
 * показывать незачем: служебное, чужие лаунчеры, старьё.
 */
export function FoundApps({
  club,
  found,
  onChanged,
}: {
  club: Club;
  found: AppSuggestion[];
  onChanged: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (found.length === 0) return null;

  function toggle(id: string): void {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      setChosen(new Set());
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Найдено на машинах</h2>
        <span className="count">{found.length}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="note" style={{ marginBottom: 10 }}>
        Это то, что агенты нашли установленным в зале. Отметьте нужное — оно встанет на полки с
        обложками. Остальное можно убрать: гостю оно не нужно.
      </div>

      <div className="cover-grid">
        {found.map((item) => (
          <article
            key={item.id}
            className={`cover-card ${chosen.has(item.id) ? "" : "muted"}`}
            aria-selected={chosen.has(item.id)}
          >
            <button type="button" className="cover-art" onClick={() => toggle(item.id)}>
              {item.coverUrl ? (
                <img
                  src={item.coverUrl}
                  alt=""
                  onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                />
              ) : (
                <span className="cover-empty">без обложки</span>
              )}
            </button>
            <div className="cover-body">
              <div className="cover-name">{item.name}</div>
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => toggle(item.id)}>
                  {chosen.has(item.id) ? "Отменить" : "Выбрать"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => api.dismissSuggestion(club.id, item.id))}
                >
                  Убрать
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="actions" style={{ marginTop: 12 }}>
        <button
          className="primary"
          type="button"
          disabled={busy || chosen.size === 0}
          onClick={() => void run(() => api.acceptSuggestions(club.id, [...chosen]))}
        >
          Поставить на полки: {chosen.size}
        </button>
        <button
          type="button"
          disabled={busy || found.length === 0}
          onClick={() => setChosen(new Set(found.map((item) => item.id)))}
        >
          Выбрать все
        </button>
      </div>
    </section>
  );
}
