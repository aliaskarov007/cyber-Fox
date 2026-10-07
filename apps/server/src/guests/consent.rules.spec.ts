import { describe, expect, it } from "vitest";

import { canInvite, consentText } from "./consent.rules.js";

describe("согласие на приглашения", () => {
  it("текст обещает редкость, способ отписки и называет подарок", () => {
    const text = consentText(50000);
    expect(text).toContain("не чаще 2 раз в месяц");
    expect(text).toContain("СТОП");
    expect(text).toMatch(/500\s₸/);
  });

  it("без подарка о подарке не говорит", () => {
    expect(consentText(0)).not.toContain("₸");
  });

  it("приглашать можно только согласившегося и не отписавшегося", () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const today = new Date();
    expect(canInvite({ marketingConsentAt: null, marketingOptOutAt: null })).toBe(false);
    expect(canInvite({ marketingConsentAt: yesterday, marketingOptOutAt: null })).toBe(true);
    expect(canInvite({ marketingConsentAt: yesterday, marketingOptOutAt: today })).toBe(false);
    // Отписался, а потом снова согласился — приглашать можно.
    expect(canInvite({ marketingConsentAt: today, marketingOptOutAt: yesterday })).toBe(true);
  });
});
