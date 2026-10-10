import { describe, expect, it } from "vitest";

import {
  AttemptLimiter,
  PROMO_CODE_PATTERN,
  generatePromoCode,
  normalizePromoCode,
  promoBlocker,
} from "./promo.rules.js";

describe("нормализация промокода", () => {
  it("регистр, пробелы и дефисы не важны", () => {
    expect(normalizePromoCode(" fox-500 ")).toBe("FOX500");
    expect(normalizePromoCode("fox 500")).toBe("FOX500");
  });

  it("кириллические двойники латинских букв становятся латиницей", () => {
    // «О» и «Х» здесь русские — на клавиатуре клуба так и набирают.
    expect(normalizePromoCode("FОХ500")).toBe("FOX500");
    expect(normalizePromoCode("сек")).toBe("CEK");
  });

  it("русские буквы без двойника остаются и не проходят проверку формата", () => {
    expect(PROMO_CODE_PATTERN.test(normalizePromoCode("ФОКС"))).toBe(false);
  });
});

describe("генерация промокода", () => {
  it("даёт код нужной длины, подходящий под формат", () => {
    const code = generatePromoCode(8);
    expect(code).toHaveLength(8);
    expect(PROMO_CODE_PATTERN.test(code)).toBe(true);
  });

  it("не использует путающиеся знаки", () => {
    for (let i = 0; i < 200; i += 1) expect(generatePromoCode(12)).not.toMatch(/[0O1I5S]/);
  });
});

describe("пригодность промокода", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const base = { clubId: null, maxUses: null, usedCount: 0, expiresAt: null, disabledAt: null };

  it("код сети без ограничений действует в любом зале", () => {
    expect(promoBlocker(base, "club-a", now)).toBeNull();
  });

  it("отключённый код не принимается", () => {
    expect(promoBlocker({ ...base, disabledAt: now }, "club-a", now)).toMatch(/не действует/);
  });

  it("срок истекает ровно в указанный момент", () => {
    expect(promoBlocker({ ...base, expiresAt: now }, "club-a", now)).toMatch(/истёк/);
    expect(
      promoBlocker({ ...base, expiresAt: new Date(now.getTime() + 1) }, "club-a", now),
    ).toBeNull();
  });

  it("код зала не действует в соседнем", () => {
    expect(promoBlocker({ ...base, clubId: "club-a" }, "club-b", now)).toMatch(/другом клубе/);
    expect(promoBlocker({ ...base, clubId: "club-a" }, "club-a", now)).toBeNull();
  });

  it("личный код принимается только у своего гостя", () => {
    const personal = { ...base, guestId: "guest-1" };
    expect(promoBlocker(personal, "club-a", now, "guest-2")).toMatch(/другого гостя/);
    expect(promoBlocker(personal, "club-a", now, "guest-1")).toBeNull();
  });

  it("лимит использований", () => {
    expect(promoBlocker({ ...base, maxUses: 3, usedCount: 2 }, "club-a", now)).toBeNull();
    expect(promoBlocker({ ...base, maxUses: 3, usedCount: 3 }, "club-a", now)).toMatch(/разобрали/);
  });
});

describe("ограничение перебора", () => {
  it("блокирует после нескольких промахов и отпускает по окну", () => {
    const limiter = new AttemptLimiter(3, 60_000);
    limiter.fail("pc-1", 0);
    limiter.fail("pc-1", 1_000);
    expect(limiter.blocked("pc-1", 2_000)).toBe(false);
    limiter.fail("pc-1", 2_000);
    expect(limiter.blocked("pc-1", 3_000)).toBe(true);
    // Соседняя машина не страдает от чужого перебора.
    expect(limiter.blocked("pc-2", 3_000)).toBe(false);
    // Первая попытка выпала из окна — снова можно.
    expect(limiter.blocked("pc-1", 60_500)).toBe(false);
  });
});
