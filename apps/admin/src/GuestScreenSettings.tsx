import { type FormEvent, useCallback, useEffect, useState } from "react";

import { type Club, type ScreenSlide, api } from "./api.js";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-KZ", { day: "numeric", month: "short" });
}

function slideStatus(slide: ScreenSlide): { label: string; chip: string } {
  const now = Date.now();
  if (!slide.isActive) return { label: "выключен", chip: "offline" };
  if (slide.endsAt && new Date(slide.endsAt).getTime() <= now) return { label: "закончился", chip: "offline" };
  if (slide.startsAt && new Date(slide.startsAt).getTime() > now) return { label: "ждёт даты", chip: "offline" };
  return { label: "на экране", chip: "in-use" };
}

function period(slide: ScreenSlide): string {
  if (!slide.startsAt && !slide.endsAt) return "без срока";
  const from = slide.startsAt ? `с ${formatDay(slide.startsAt)}` : "";
  const to = slide.endsAt ? `по ${formatDay(slide.endsAt)}` : "";
  return [from, to].filter(Boolean).join(" ");
}

/**
 * Карусель на экране блокировки игровых ПК. Турниры попадают туда сами из
 * «Ивентов» — здесь только рекламные слайды: партнёры, акции бара, ночной
 * тариф. Счётчик показов — то, что можно показать партнёру.
 */
export function GuestScreenSettings({ club, isOwner }: { club: Club; isOwner: boolean }) {
  const [slides, setSlides] = useState<ScreenSlide[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSlides(await api.slides(club.id));
  }, [club.id]);

  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
  }, [load]);

  async function act(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Экран гостя: карусель</h2>
      </div>
      <p className="hint">
        На экране блокировки игровых ПК — название клуба, слоган (меняются выше, в настройках клуба) и
        карусель. Ближайшие турниры из «Ивентов» попадают в неё сами, между ними крутятся слайды
        отсюда. Слайд партнёра помечается на экране словом «Реклама».
      </p>
      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Слайд</th>
              <th>Где</th>
              <th>Когда</th>
              <th>Показы</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slides.map((slide) => {
              const status = slideStatus(slide);
              const canEdit = !slide.networkWide || isOwner;
              return (
                <tr key={slide.id} style={status.chip === "offline" ? { opacity: 0.6 } : undefined}>
                  <td>
                    <strong>{slide.title}</strong>
                    {slide.partner && (
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Реклама · {slide.partner}</div>
                    )}
                  </td>
                  <td>{slide.networkWide ? "вся сеть" : "этот клуб"}</td>
                  <td>{period(slide)}</td>
                  <td className="num">{slide.impressions.toLocaleString("ru-KZ")}</td>
                  <td>
                    <span className={`chip ${status.chip}`}>{status.label}</span>
                  </td>
                  <td>
                    {canEdit && (
                      <div className="actions">
                        <button
                          onClick={() =>
                            void act(() => api.updateSlide(club.id, slide.id, { isActive: !slide.isActive }))
                          }
                        >
                          {slide.isActive ? "Выключить" : "Включить"}
                        </button>
                        <button
                          onClick={() => {
                            if (!window.confirm(`Удалить слайд «${slide.title}»? Счётчик показов пропадёт.`)) return;
                            void act(() => api.deleteSlide(club.id, slide.id));
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {slides.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--muted)" }}>
                  Рекламных слайдов пока нет — на экране крутятся только турниры
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SlideForm club={club} isOwner={isOwner} onCreated={() => void load()} />
    </section>
  );
}

function SlideForm({ club, isOwner, onCreated }: { club: Club; isOwner: boolean; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [partner, setPartner] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [networkWide, setNetworkWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.uploadCover(club.id, file);
      setImageUrl(url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createSlide(club.id, {
        title: title.trim(),
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(partner.trim() ? { partner: partner.trim() } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        // Даты — по дню: показ с начала первого дня до конца последнего.
        ...(startsAt ? { startsAt: new Date(`${startsAt}T00:00`).toISOString() } : {}),
        ...(endsAt ? { endsAt: new Date(`${endsAt}T23:59:59`).toISOString() } : {}),
        ...(networkWide ? { networkWide: true } : {}),
      });
      setTitle("");
      setText("");
      setPartner("");
      setImageUrl(null);
      setStartsAt("");
      setEndsAt("");
      onCreated();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <h3 style={{ margin: "16px 0 8px" }}>Новый слайд</h3>
      {error && <div className="error">{error}</div>}
      <form className="settings-grid" onSubmit={submit}>
        <label>
          Заголовок
          <input
            value={title}
            maxLength={60}
            placeholder="Red Bull — 2 по цене 1"
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          Партнёр (пусто — своя акция)
          <input value={partner} maxLength={40} placeholder="Red Bull" onChange={(e) => setPartner(e.target.value)} />
        </label>
        <label className="wide">
          Текст
          <input
            value={text}
            maxLength={200}
            placeholder="Только до конца месяца, спрашивайте на баре"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          Показывать с
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label>
          по
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <label>
          Картинка (по желанию)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {imageUrl && <span className="hint">Картинка загружена</span>}
        </label>
        {isOwner && (
          <label>
            Где показывать
            <select
              value={networkWide ? "network" : "club"}
              onChange={(e) => setNetworkWide(e.target.value === "network")}
            >
              <option value="club">Только в «{club.name}»</option>
              <option value="network">Во всех филиалах сети</option>
            </select>
          </label>
        )}
        <button className="primary" type="submit" disabled={busy || title.trim().length < 2}>
          Добавить слайд
        </button>
      </form>
    </div>
  );
}
