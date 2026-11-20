export interface TopUpBonusTierState {
  minTopUp: number;
  bonus: number;
}

/**
 * Бонус за пополнение по порогам: берём самый высокий порог, которого достигло
 * пополнение, и начисляем его бонус. Пополнил ниже всех порогов — ноль.
 */
export function pickTopUpBonus(
  tiers: TopUpBonusTierState[],
  amount: number,
): number {
  let bestThreshold = -1;
  let bonus = 0;
  for (const tier of tiers) {
    if (amount >= tier.minTopUp && tier.minTopUp > bestThreshold) {
      bestThreshold = tier.minTopUp;
      bonus = tier.bonus;
    }
  }
  return bonus > 0 ? bonus : 0;
}
