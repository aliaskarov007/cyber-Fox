import { describe, expect, it } from "vitest";

import { ImpressionThrottle, buildCarousel, isAdLive, isEventUpcoming, slideBlocker } from "./screen.rules.js";

const now = new Date("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number): Date => new Date(now.getTime() + n * DAY);

const event = (id: string, days: number, extra: Partial<{ canceledAt: Date; clubId: string }> = {}) => ({
  id,
  title: `Турнир ${id}`,
  description: null,
  startsAt: inDays(days),
  canceledAt: extra.canceledAt ?? null,
  clubId: extra.clubId ?? "club-1",
  clubName: extra.clubId ? "Другой зал" : "Наш зал",
});

const ad = (id: string, sortOrder = 0, extra: Partial<{ isActive: boolean; startsAt: Date; endsAt: Date }> = {}) => ({
  id,
  title: `Реклама ${id}`,
  text: null,
  imageUrl: null,
  partner: "Партнёр",
  isActive: extra.isActive ?? true,
  startsAt: extra.startsAt ?? null,
  endsAt: extra.endsAt ?? null,
  sortOrder,
});

describe("какие турниры на экране", () => {
  it("прошедшие, отменённые и дальше месяца — нет", () => {
    expect(isEventUpcoming(event("a", -1), now)).toBe(false);
    expect(isEventUpcoming(event("b", 3, { canceledAt: now }), now)).toBe(false);
    expect(isEventUpcoming(event("c", 31), now)).toBe(false);
    expect(isEventUpcoming(event("d", 3), now)).toBe(true);
  });
});

describe("какая реклама идёт", () => {
  it("уважает выключатель и даты показа", () => {
    expect(isAdLive(ad("a"), now)).toBe(true);
    expect(isAdLive(ad("b", 0, { isActive: false }), now)).toBe(false);
    expect(isAdLive(ad("c", 0, { startsAt: inDays(1) }), now)).toBe(false);
    expect(isAdLive(ad("d", 0, { endsAt: now }), now)).toBe(false);
    expect(isAdLive(ad("e", 0, { startsAt: inDays(-1), endsAt: inDays(1) }), now)).toBe(true);
  });
});

describe("порядок карусели", () => {
  it("турниры по дате, реклама между ними, остаток в конце", () => {
    const slides = buildCarousel(
      [event("late", 5), event("soon", 1)],
      [ad("x", 2), ad("y", 1), ad("z", 3)],
      "club-1",
      now,
    );
    expect(slides.map((s) => s.id)).toEqual(["soon", "y", "late", "x", "z"]);
  });

  it("турнир другого зала подписан его названием", () => {
    const [slide] = buildCarousel([event("n", 2, { clubId: "club-2" })], [], "club-1", now);
    expect(slide).toMatchObject({ kind: "event", clubName: "Другой зал" });
  });

  it("без турниров и рекламы — пусто", () => {
    expect(buildCarousel([], [], "club-1", now)).toEqual([]);
  });
});

describe("слайд", () => {
  it("нужен заголовок и правильные даты", () => {
    expect(slideBlocker({ title: " ", startsAt: null, endsAt: null })).toMatch(/заголовок/);
    expect(slideBlocker({ title: "Red Bull", startsAt: inDays(2), endsAt: inDays(1) })).toMatch(/раньше/);
    expect(slideBlocker({ title: "Red Bull", startsAt: null, endsAt: inDays(1) })).toBeNull();
  });
});

describe("счётчик показов", () => {
  it("одна машина засчитывает слайд раз в минуту", () => {
    const throttle = new ImpressionThrottle(60_000);
    expect(throttle.allow("pc1", "s1", 0)).toBe(true);
    expect(throttle.allow("pc1", "s1", 30_000)).toBe(false);
    expect(throttle.allow("pc2", "s1", 30_000)).toBe(true);
    expect(throttle.allow("pc1", "s1", 60_000)).toBe(true);
  });
});
