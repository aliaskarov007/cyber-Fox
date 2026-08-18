import { useEffect, useMemo, useRef, useState } from "react";

import { type LibraryApp, byGenre, favouritesFirst, genres, inSection, search } from "../shared/library.js";

/**
 * Что видит гость после оплаты: полки игр вместо рабочего стола.
 *
 * Игры и программы разведены по вкладкам: за игрой приходят, браузер открывают
 * между делом, и мешать их в одном списке — значит заставлять искать. Жанры
 * стоят кнопками, а не полками одна под другой: так весь выбор помещается на
 * экран без прокрутки.
 */
export function Shell({
  apps,
  favourites,
  onLaunch,
  onToggleFavourite,
}: {
  apps: LibraryApp[];
  /** Что этот гость отметил своим. Пусто у анонимной посадки. */
  favourites: string[];
  onLaunch: (app: LibraryApp) => void;
  /** Пусто — отмечать некому: сессия без гостя. */
  onToggleFavourite: ((app: LibraryApp, on: boolean) => void) | null;
}) {
  const [section, setSection] = useState<"GAME" | "APP">("GAME");
  const [genre, setGenre] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [launching, setLaunching] = useState<LibraryApp | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * Печать где угодно попадает в поиск. За игровым ПК гость держит руки на
   * клавиатуре, и требовать сначала кликнуть в поле — лишний шаг.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setQuery("");
        return;
      }
      const onControl = event.target instanceof HTMLElement && event.target !== document.body;
      if (onControl || event.key === " ") return;
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const here = useMemo(() => inSection(apps, section), [apps, section]);
  const buttons = useMemo(() => genres(here), [here]);
  const shown = useMemo(
    () => favouritesFirst(search(byGenre(here, genre), query), favourites),
    [here, genre, query, favourites],
  );

  if (apps.length === 0) {
    return (
      <div className="shell-empty">
        <div className="shell-empty-title">Игры ещё не добавлены</div>
        <div className="shell-empty-hint">
          Каталог зала пуст. Подойдите к администратору — он добавит игры из кассы, и они появятся
          здесь без перезагрузки.
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="shell-head">
        {(["GAME", "APP"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className="shell-tab"
            aria-selected={section === tab}
            onClick={() => {
              setSection(tab);
              // Жанр относится к вкладке: на другой его может не быть вовсе.
              setGenre(null);
            }}
          >
            {tab === "GAME" ? "Игры" : "Приложения"}
          </button>
        ))}
      </div>

      <div className="shell-toolbar">
        <input
          ref={inputRef}
          className="shell-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск"
          aria-label="Поиск игры"
        />

        <button
          type="button"
          className="genre"
          aria-pressed={genre === null}
          onClick={() => setGenre(null)}
        >
          Все
        </button>
        {buttons.map((name) => (
          <button
            key={name}
            type="button"
            className="genre"
            aria-pressed={genre === name}
            onClick={() => setGenre(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="shell-empty-hint">Ничего не нашли</div>
      ) : (
        <div className="tiles">
          {shown.map((app) => {
            const marked = favourites.includes(app.id);
            return (
              <div className="tile-wrap" key={app.id}>
                <button
                  className="tile"
                  type="button"
                  onClick={() => {
                    setLaunching(app);
                    onLaunch(app);
                  }}
                >
                  <span className="tile-art">
                    {app.coverUrl ? (
                      <img
                        src={app.coverUrl}
                        alt=""
                        onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                      />
                    ) : (
                      <span className="tile-letter">{app.name.slice(0, 1)}</span>
                    )}
                  </span>
                  <span className="tile-name">{app.name}</span>
                </button>

                {/* Отмечать некому, если сессия анонимная: сердечко просто не показываем. */}
                {onToggleFavourite && (
                  <button
                    type="button"
                    className="tile-fav"
                    aria-pressed={marked}
                    aria-label={marked ? "Убрать из моих" : "В мои игры"}
                    onClick={() => onToggleFavourite(app, !marked)}
                  >
                    {marked ? "♥" : "♡"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="shell-hint">Вернуться к играм из запущенной игры — Ctrl + Alt + Home</div>

      {launching && (
        <div className="launching">
          <div className="launching-name">Запускаем «{launching.name}»</div>
          <div className="launching-hint">
            Игра откроется через несколько секунд и встанет поверх полок. Закроете её — снова
            окажетесь здесь. Вернуться раньше — Ctrl + Alt + Home
          </div>
        </div>
      )}
    </div>
  );
}
