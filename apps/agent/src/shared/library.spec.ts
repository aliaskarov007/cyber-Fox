import { describe, expect, it } from "vitest";

import {
  type LibraryApp,
  byGenre,
  favouritesFirst,
  genres,
  inSection,
  search,
  shelves,
} from "./library.js";

function app(
  name: string,
  category: string | null = null,
  section: "GAME" | "APP" = "GAME",
): LibraryApp {
  return {
    id: name,
    name,
    category,
    section,
    kind: "EXECUTABLE",
    target: "C:\\game.exe",
    args: [],
    coverUrl: null,
  };
}

describe("полки", () => {
  it("держат порядок каталога: владелец ставит ходовое первым", () => {
    const list = shelves([app("CS2", "Шутеры"), app("Dota", "MOBA"), app("Valorant", "Шутеры")]);
    expect(list.map((s) => s.title)).toEqual(["Шутеры", "MOBA"]);
    expect(list[0].apps.map((a) => a.name)).toEqual(["CS2", "Valorant"]);
  });

  it("сваливают безкатегорийное в «Остальное» и опускают эту полку вниз", () => {
    const list = shelves([app("Блокнот"), app("CS2", "Шутеры")]);
    expect(list.map((s) => s.title)).toEqual(["Шутеры", "Остальное"]);
  });

  it("пустая категория — то же, что её отсутствие", () => {
    expect(shelves([app("Блокнот", "   ")])[0].title).toBe("Остальное");
  });
});

describe("поиск", () => {
  const catalog = [app("Counter-Strike 2"), app("Dota 2"), app("Discounter")];

  it("пустой запрос ничего не отсеивает", () => {
    expect(search(catalog, "  ")).toHaveLength(3);
  });

  it("совпадение с начала названия важнее совпадения внутри слова", () => {
    expect(search(catalog, "counter").map((a) => a.name)).toEqual(["Counter-Strike 2", "Discounter"]);
  });

  it("находит по второму слову: гость печатает «strike»", () => {
    expect(search(catalog, "strike").map((a) => a.name)).toEqual(["Counter-Strike 2"]);
  });

  it("не зависит от регистра", () => {
    expect(search(catalog, "DOTA").map((a) => a.name)).toEqual(["Dota 2"]);
  });

  it("не находит того, чего нет", () => {
    expect(search(catalog, "варкрафт")).toEqual([]);
  });
});

describe("вкладки и жанры", () => {
  const catalog = [
    app("CS2", "Шутеры"),
    app("Dota", "MOBA"),
    app("Блокнот", null, "APP"),
    app("Chrome", "Программы", "APP"),
  ];

  it("вкладка показывает только своё: программы не мешают выбирать игру", () => {
    expect(inSection(catalog, "GAME").map((a) => a.name)).toEqual(["CS2", "Dota"]);
    expect(inSection(catalog, "APP").map((a) => a.name)).toEqual(["Блокнот", "Chrome"]);
  });

  it("кнопки жанров — только те, что есть: пустая кнопка выглядит поломкой", () => {
    expect(genres(inSection(catalog, "GAME"))).toEqual(["Шутеры", "MOBA"]);
  });

  it("безжанровое собирается в «Остальное» и уходит в конец", () => {
    expect(genres(inSection(catalog, "APP"))).toEqual(["Программы", "Остальное"]);
  });

  it("выбор жанра оставляет только его, а пустой выбор — всё", () => {
    expect(byGenre(catalog, "MOBA").map((a) => a.name)).toEqual(["Dota"]);
    expect(byGenre(catalog, null)).toHaveLength(4);
  });
});

describe("избранное", () => {
  it("отмеченные встают первыми, порядок остальных не меняется", () => {
    const list = [app("A"), app("Б"), app("В")];
    expect(favouritesFirst(list, ["В"]).map((a) => a.name)).toEqual(["В", "A", "Б"]);
  });

  it("без отметок ничего не переставляется", () => {
    const list = [app("A"), app("Б")];
    expect(favouritesFirst(list, []).map((a) => a.name)).toEqual(["A", "Б"]);
  });
});
