import { describe, expect, it } from "vitest";

import { type LibraryApp, search, shelves } from "./library.js";

function app(name: string, category: string | null = null): LibraryApp {
  return { id: name, name, category, kind: "EXECUTABLE", target: "C:\\game.exe", args: [], coverUrl: null };
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
