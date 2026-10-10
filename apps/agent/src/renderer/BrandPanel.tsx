import { useEffect, useState } from "react";

import type { AgentClient, GuestScreen, ScreenSlide } from "./agent-client.js";

/** Сколько слайд стоит на экране. Достаточно, чтобы прочитать с места. */
const SLIDE_MS = 8_000;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Левая половина экрана блокировки: название клуба, слоган и карусель с
 * ближайшими турнирами и рекламой партнёров. Всё меняется в настройках кассы,
 * машина получает сигнал и перерисовывает экран без перезапуска.
 */
export function BrandPanel({
  client,
  screen,
  fallbackName,
}: {
  client: AgentClient;
  screen: GuestScreen | null;
  fallbackName: string | null;
}) {
  const slides = screen?.slides ?? [];
  const [index, setIndex] = useState(0);

  // Набор слайдов поменялся — начинаем сначала, чтобы не встать за край списка.
  const signature = slides.map((s) => s.id).join(",");
  useEffect(() => setIndex(0), [signature]);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [slides.length, signature]);

  const current: ScreenSlide | undefined = slides[index];

  // Показ рекламы засчитывается партнёру; сервер сам не даёт накрутить.
  useEffect(() => {
    if (current?.kind === "ad") client.screenImpression(current.id);
  }, [client, current?.id, current?.kind]);

  const name = screen?.clubName || fallbackName || "Cyber-Fox";

  return (
    <section className="brand">
      <div className="brand-head">
        <h1 className="club-name">{name}</h1>
        {screen?.slogan && <p className="slogan">{screen.slogan}</p>}
      </div>

      {current && (
        <div className="carousel">
          <Slide client={client} slide={current} key={current.id} />
          {slides.length > 1 && (
            <div className="dots" aria-hidden>
              {slides.map((s, i) => (
                <span key={s.id} className={i === index ? "on" : ""} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Slide({ client, slide }: { client: AgentClient; slide: ScreenSlide }) {
  if (slide.kind === "event") {
    return (
      <article className="slide event">
        <div className="slide-tag">Турнир{slide.clubName ? ` · ${slide.clubName}` : ""}</div>
        <div className="slide-title">{slide.title}</div>
        <div className="slide-when">{dateFormat.format(new Date(slide.startsAt))}</div>
        {slide.text && <div className="slide-text">{slide.text}</div>}
        <div className="slide-hint">Записаться — у администратора</div>
      </article>
    );
  }

  return (
    <article className={`slide ad ${slide.imageUrl ? "with-image" : ""}`}>
      {slide.imageUrl && <img className="slide-image" src={client.resolveUrl(slide.imageUrl)} alt="" />}
      <div className="slide-body">
        {/* Реклама партнёра помечается как реклама — гость должен это видеть. */}
        {slide.partner && <div className="slide-tag">Реклама · {slide.partner}</div>}
        <div className="slide-title">{slide.title}</div>
        {slide.text && <div className="slide-text">{slide.text}</div>}
      </div>
    </article>
  );
}
