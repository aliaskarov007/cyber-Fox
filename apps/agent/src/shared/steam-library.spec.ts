import { describe, expect, it } from "vitest";

import { coverUrl, dedupe, launchUri, libraryPaths, parseManifest } from "./steam-library.js";

describe("библиотеки Steam", () => {
  it("достаёт пути и разворачивает двойные слэши", () => {
    const vdf = `
      "libraryfolders"
      {
        "0"
        {
          "path"    "C:\\\\Program Files (x86)\\\\Steam"
          "label"   ""
        }
        "1"
        {
          "path"    "D:\\\\SteamLibrary"
        }
      }`;
    expect(libraryPaths(vdf)).toEqual(["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
  });

  it("пустой файл не роняет разбор", () => {
    expect(libraryPaths("")).toEqual([]);
  });
});

describe("описание установленной игры", () => {
  const acf = `
    "AppState"
    {
      "appid"    "730"
      "name"     "Counter-Strike 2"
      "StateFlags"  "4"
    }`;

  it("читает идентификатор и название", () => {
    expect(parseManifest(acf)).toEqual({ appId: "730", name: "Counter-Strike 2" });
  });

  it("пропускает запись без названия: недокачанная игра не станет пустой плиткой", () => {
    expect(parseManifest('"AppState" { "appid" "730" }')).toBeNull();
  });

  it("пропускает запись без идентификатора: без него нет ни запуска, ни обложки", () => {
    expect(parseManifest('"AppState" { "name" "Что-то" }')).toBeNull();
  });
});

describe("что уходит на сервер", () => {
  const game = { appId: "730", name: "Counter-Strike 2" };

  it("ссылка запуска и обложка строятся по идентификатору", () => {
    expect(launchUri(game)).toBe("steam://rungameid/730");
    expect(coverUrl(game)).toContain("/steam/apps/730/");
  });

  it("одна игра в двух библиотеках приходит один раз", () => {
    const list = dedupe([game, { appId: "730", name: "Counter-Strike 2" }, { appId: "570", name: "Dota 2" }]);
    expect(list.map((g) => g.appId)).toEqual(["730", "570"]);
  });

  it("порядок по названию: список читает человек", () => {
    const list = dedupe([{ appId: "2", name: "Ядро" }, { appId: "1", name: "Апекс" }]);
    expect(list.map((g) => g.name)).toEqual(["Апекс", "Ядро"]);
  });
});
