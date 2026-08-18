import { useEffect, useState } from "react";

import { type AppSuggestion, type Club, type ClubApp, type Zone, api } from "./api.js";
import { FoundApps } from "./FoundApps.js";
import { LibraryForm } from "./LibraryForm.js";

/**
 * Игры зала: то, что гость увидит на полках после оплаты.
 *
 * Список показан плитками с обложками, а не строками таблицы: владелец
 * собирает здесь витрину, и судить о ней проще по тому же виду, в каком её
 * увидит гость.
 */
export function LibraryScreen({ club }: { club: Club }) {
  const [apps, setApps] = useState<ClubApp[]>([]);
  const [found, setFound] = useState<AppSuggestion[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [editing, setEditing] = useState<ClubApp | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const [nextApps, nextZones, nextFound] = await Promise.all([
        api.apps(club.id),
        api.zones(club.id),
        api.appSuggestions(club.id),
      ]);
      setApps(nextApps);
      setZones(nextZones);
      setFound(nextFound);
    } catch (cause) {
      // Молчаливый пустой экран здесь неотличим от «каталог пуст».
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [club.id]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const zoneName = (id: string | null): string =>
    id === null ? "во всех зонах" : `только ${zones.find((z) => z.id === id)?.name ?? "—"}`;

  return (
    <main>
      {error && <div className="error">{error}</div>}

      {/* Найденное стоит выше каталога: это то, что требует решения. */}
      <FoundApps club={club} found={found} onChanged={() => void load()} />

      <section className="zone-block">
        <div className="zone-head">
          <h2>Игры и программы</h2>
          <button
            className="primary"
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Добавить игру
          </button>
        </div>

        {formOpen && (
          <LibraryForm
            key={editing?.id ?? "new"}
            club={club}
            zones={zones}
            editing={editing}
            onClose={() => {
              setFormOpen(false);
              setEditing(null);
            }}
            onSaved={() => {
              setFormOpen(false);
              setEditing(null);
              void load();
            }}
          />
        )}

        {apps.length === 0 ? (
          <div className="notice">
            Пока каталог пуст, гость после оплаты увидит пустую оболочку. Добавьте хотя бы то, во что
            в зале играют каждый день.
          </div>
        ) : (
          <div className="cover-grid">
            {apps.map((app) => (
              <article key={app.id} className={`cover-card ${app.isActive ? "" : "muted"}`}>
                <div className="cover-art">
                  {app.coverUrl ? (
                    <img
                      src={app.coverUrl}
                      alt=""
                      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                    />
                  ) : (
                    <span className="cover-empty">без обложки</span>
                  )}
                </div>
                <div className="cover-body">
                  <div className="cover-name">{app.name}</div>
                  <div className="cover-meta">
                    {app.category ?? "общая полка"} · {zoneName(app.zoneId)}
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(app);
                        setFormOpen(true);
                      }}
                    >
                      Править
                    </button>
                    <button
                      type="button"
                      onClick={() => void run(() => api.updateApp(club.id, app.id, { isActive: !app.isActive }))}
                    >
                      {app.isActive ? "Скрыть" : "Вернуть"}
                    </button>
                    <button type="button" onClick={() => void run(() => api.deleteApp(club.id, app.id))}>
                      Удалить
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
