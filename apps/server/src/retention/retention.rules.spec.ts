import { describe, expect, it } from "vitest";

import {
  DEFAULT_MESSAGE,
  DEFAULT_OPTIONS,
  OPT_OUT_LINE,
  churnByMonth,
  classify,
  isRegular,
  lastMonths,
  messageBlocker,
  monthKey,
  monthlySpend,
  partOfDay,
  recentlyContacted,
  renderMessage,
} from "./retention.rules.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-10T12:00:00Z");
const daysAgo = (n: number): Date => new Date(now.getTime() - n * DAY);

describe("где гость сейчас", () => {
  it("ходил недавно — активен", () => {
    expect(classify({ lastAt: daysAgo(2), medianGapDays: 3 }, now, DEFAULT_OPTIONS)).toEqual({
      status: "active",
      daysSince: 2,
    });
  });

  it("пропал на две недели при ритме раз в три дня — под угрозой", () => {
    expect(classify({ lastAt: daysAgo(14), medianGapDays: 3 }, now, DEFAULT_OPTIONS).status).toBe("at_risk");
  });

  it("гость, ходящий раз в две недели, через десять дней ещё не под угрозой", () => {
    expect(classify({ lastAt: daysAgo(10), medianGapDays: 14 }, now, DEFAULT_OPTIONS).status).toBe("active");
  });

  it("меньше недели тревогой не считается, какой бы частый ни был ритм", () => {
    expect(classify({ lastAt: daysAgo(5), medianGapDays: 0.2 }, now, DEFAULT_OPTIONS).status).toBe("active");
  });

  it("порог ухода срабатывает ровно на заданный день", () => {
    expect(classify({ lastAt: daysAgo(29), medianGapDays: 30 }, now, DEFAULT_OPTIONS).status).not.toBe("lost");
    expect(classify({ lastAt: daysAgo(30), medianGapDays: 30 }, now, DEFAULT_OPTIONS).status).toBe("lost");
  });

  it("постоянный — с заданного числа визитов", () => {
    expect(isRegular({ visits: 2 }, DEFAULT_OPTIONS)).toBe(false);
    expect(isRegular({ visits: 3 }, DEFAULT_OPTIONS)).toBe(true);
  });
});

describe("время суток", () => {
  it("раскладывает часы словами", () => {
    expect(partOfDay(9)).toBe("утро");
    expect(partOfDay(15)).toBe("день");
    expect(partOfDay(21)).toBe("вечер");
    expect(partOfDay(2)).toBe("ночь");
    expect(partOfDay(null)).toBeNull();
  });
});

describe("месяцы ухода", () => {
  it("месяц считается в поясе зала", () => {
    // 31 августа 20:00 UTC — в Алматы уже 1 сентября.
    expect(monthKey(new Date("2026-08-31T20:00:00Z"), "Asia/Almaty")).toBe("2026-09");
  });

  it("последние месяцы идут от старого к новому и переходят через год", () => {
    expect(lastMonths(new Date("2026-02-10T12:00:00Z"), "Asia/Almaty", 4)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("раскладывает ушедших по месяцу последнего визита", () => {
    const result = churnByMonth(
      [
        { lastAt: new Date("2026-08-05T12:00:00Z"), firstAt: new Date("2026-06-05T12:00:00Z"), spent: 60_000_00, visits: 10 },
        { lastAt: new Date("2026-08-20T12:00:00Z"), firstAt: new Date("2026-08-01T12:00:00Z"), spent: 5_000_00, visits: 3 },
        { lastAt: new Date("2025-01-01T12:00:00Z"), firstAt: new Date("2024-12-01T12:00:00Z"), spent: 1, visits: 3 },
      ],
      ["2026-08", "2026-09"],
      "Asia/Almaty",
    );
    expect(result[0]).toMatchObject({ month: "2026-08", guests: 2 });
    expect(result[1]).toEqual({ month: "2026-09", guests: 0, monthlySpend: 0 });
  });
});

describe("цена ухода", () => {
  it("делит потраченное на месяцы, пока гость ходил", () => {
    expect(
      monthlySpend({ spent: 60_000_00, firstAt: daysAgo(90), lastAt: now }),
    ).toBe(20_000_00);
  });

  it("гость меньше месяца считается за один месяц", () => {
    expect(monthlySpend({ spent: 5_000_00, firstAt: daysAgo(5), lastAt: now })).toBe(5_000_00);
  });
});

describe("сообщение ушедшему гостю", () => {
  it("подставляет имя, клуб, подарок, код и срок и всегда добавляет «СТОП»", () => {
    const text = renderMessage(DEFAULT_MESSAGE, {
      name: "Айдар Нурланов",
      club: "Cyber Arena",
      gift: "1 000 ₸ на счёт",
      code: "K7QX2M4P",
      until: "25 октября",
    });
    expect(text).toContain("Айдар, давно вас не видели в «Cyber Arena»");
    expect(text).toContain("K7QX2M4P");
    expect(text).toContain("до 25 октября");
    expect(text.endsWith(OPT_OUT_LINE)).toBe(true);
    expect(text).not.toMatch(/\{[а-я]+\}/);
  });

  it("без {код} текст не уходит", () => {
    expect(messageBlocker("Привет! Давно не виделись, приходите — ждём вас.")).toMatch(/код/);
    expect(messageBlocker(DEFAULT_MESSAGE)).toBeNull();
  });

  it("не пишем одному гостю чаще раза в месяц", () => {
    expect(recentlyContacted(daysAgo(10), now)).toBe(true);
    expect(recentlyContacted(daysAgo(31), now)).toBe(false);
    expect(recentlyContacted(null, now)).toBe(false);
  });
});
