import { useEffect, useMemo, useRef, useState } from "react";

import { type LibraryApp, search, shelves } from "../shared/library.js";

/**
 * Что видит гость после оплаты: полки игр вместо рабочего стола.
 *
 * Гость садится играть, а не разбираться в меню, поэтому обложки крупные,
 * подписи короткие, а поиск начинается с первой набранной буквы — без поля,
 * которое надо сперва найти мышкой.
 */
export function Shell({
  apps,
  onLaunch,
}: {
  apps: LibraryApp[];
  onLaunch: (app: LibraryApp) => void;
}) {
  const [query, setQuery] = useState("");
  /** Что сейчас запускается: между нажатием и появлением игры проходят секунды. */
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
      /*
       * Пробел не считается началом поиска, и на кнопках фокус не перехватывается:
       * пробелом гость нажимает кнопку, на которой стоит, а перевод фокуса в
       * поле отменял бы это нажатие.
       */
      const onControl = event.target instanceof HTMLElement && event.target !== document.body;
      if (onControl || event.key === " ") return;

      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const found = useMemo(() => search(apps, query), [apps, query]);
  const rows = useMemo(() => shelves(found), [found]);

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
      <input
        ref={inputRef}
        className="shell-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Начните печатать название"
        aria-label="Поиск игры"
      />

      {rows.length === 0 && <div className="shell-empty-hint">Ничего не нашли по запросу</div>}

      {rows.map((shelf) => (
        <section className="shelf" key={shelf.title}>
          <h2 className="shelf-title">{shelf.title}</h2>
          <div className="shelf-row">
            {shelf.apps.map((app) => (
              <button
                key={app.id}
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
            ))}
          </div>
        </section>
      ))}

      <div className="shell-hint">Вернуться к играм из запущенной игры — Ctrl + Alt + Home</div>

      {launching && (
        <div className="launching">
          <div className="launching-name">Запускаем «{launching.name}»</div>
          <div className="launching-hint">
            Игра откроется через несколько секунд. Вернуться к полкам — Ctrl + Alt + Home
          </div>
        </div>
      )}
    </div>
  );
}
