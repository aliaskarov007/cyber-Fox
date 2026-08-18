import { describe, expect, it } from "vitest";

import { coverExtension, coverFileName, isAllowedCover } from "./cover-name.js";

describe("обложка, присланная файлом", () => {
  it("картинки разрешены, остальное нет", () => {
    expect(isAllowedCover("image/png")).toBe(true);
    expect(isAllowedCover("IMAGE/JPEG")).toBe(true);
    expect(isAllowedCover("application/x-msdownload")).toBe(false);
    expect(isAllowedCover("text/html")).toBe(false);
  });

  it("расширение берётся по типу файла, а не по присланному имени", () => {
    expect(coverExtension("image/png", "игра.exe")).toBe(".png");
  });

  it("имя файла своё: присланное может содержать что угодно", () => {
    const name = coverFileName("abc-123", "image/webp", "../../../etc/passwd");
    expect(name).toBe("abc-123.webp");
  });

  it("нераспознанный тип с картиночным расширением сохраняет расширение", () => {
    expect(coverExtension("application/octet-stream", "cover.PNG")).toBe(".png");
  });

  it("нераспознанное вообще становится jpg, а не остаётся чужим", () => {
    expect(coverExtension("application/octet-stream", "cover.svg")).toBe(".jpg");
  });
});
