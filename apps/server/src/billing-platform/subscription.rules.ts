/**
 * Правила подписки на платформу — чистые функции.
 *
 * Здесь решается, работает ли зал вообще, поэтому логика вынесена из сервиса
 * и проверяется тестами. Главный принцип: **неоплата не гасит зал мгновенно**.
 * Клуб живёт сменами по 12 часов, и остановка посреди смены из-за проспавшего
 * платёж бухгалтера — это потерянная выручка и разъярённые гости, а не рычаг
 * давления. Сначала предупреждение, потом льготный период, и только затем
 * запрет запускать новые сессии — уже идущие всегда доигрывают.
 */

export const SubscriptionPlan = {
  TRIAL: "TRIAL",
  BASIC: "BASIC",
  PRO: "PRO",
} as const;
export type SubscriptionPlan = (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan];

export const SubscriptionStatus = {
  TRIALING: "TRIALING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  SUSPENDED: "SUSPENDED",
  CANCELED: "CANCELED",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** Пробный период после самостоятельной регистрации. */
export const TRIAL_DAYS = 14;
/** Сколько зал работает после просрочки платежа. */
export const GRACE_DAYS = 7;

export interface PlanDefinition {
  plan: SubscriptionPlan;
  title: string;
  maxComputers: number;
  /** Цена за машину в месяц, в тиын. */
  pricePerComputer: number;
  multiClub: boolean;
}

export const PLANS: Record<SubscriptionPlan, PlanDefinition> = {
  TRIAL: {
    plan: SubscriptionPlan.TRIAL,
    title: "Пробный период",
    maxComputers: 60,
    pricePerComputer: 0,
    multiClub: false,
  },
  BASIC: {
    plan: SubscriptionPlan.BASIC,
    title: "Один зал",
    maxComputers: 60,
    pricePerComputer: 30_000, // 300 ₸ за машину в месяц
    multiClub: false,
  },
  PRO: {
    plan: SubscriptionPlan.PRO,
    title: "Сеть залов",
    maxComputers: 500,
    pricePerComputer: 25_000, // 250 ₸: сеть платит меньше за машину
    multiClub: true,
  },
};

export interface SubscriptionState {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  maxComputers: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
}

export const AccessLevel = {
  /** Всё работает. */
  FULL: "FULL",
  /** Работает, но пора платить: показываем предупреждение. */
  WARNING: "WARNING",
  /** Новые сессии запускать нельзя; идущие доигрывают. */
  READ_ONLY: "READ_ONLY",
} as const;
export type AccessLevel = (typeof AccessLevel)[keyof typeof AccessLevel];

export interface AccessDecision {
  level: AccessLevel;
  /** Что показать владельцу. Пусто — всё в порядке. */
  message: string | null;
  /** Сколько дней осталось до следующей ступени. */
  daysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));

/**
 * Что доступно сети прямо сейчас.
 *
 * Идущие сессии не прерываются ни при каком статусе: гость заплатил клубу,
 * и его игра не должна зависеть от расчётов клуба с нами.
 */
export function evaluateAccess(state: SubscriptionState, now: Date): AccessDecision {
  if (state.status === SubscriptionStatus.CANCELED) {
    return {
      level: AccessLevel.READ_ONLY,
      message: "Подписка отменена. Новые сессии не запускаются, данные доступны для выгрузки.",
      daysLeft: null,
    };
  }

  if (state.status === SubscriptionStatus.SUSPENDED) {
    return {
      level: AccessLevel.READ_ONLY,
      message: "Оплата не поступила. Новые сессии не запускаются — оплатите счёт.",
      daysLeft: null,
    };
  }

  if (state.status === SubscriptionStatus.TRIALING) {
    const endsAt = state.trialEndsAt;
    if (!endsAt) return { level: AccessLevel.FULL, message: null, daysLeft: null };

    if (endsAt <= now) {
      return {
        level: AccessLevel.READ_ONLY,
        message: "Пробный период закончился. Выберите тариф, чтобы продолжить работу.",
        daysLeft: 0,
      };
    }

    const daysLeft = daysBetween(now, endsAt);
    return {
      level: daysLeft <= 3 ? AccessLevel.WARNING : AccessLevel.FULL,
      message:
        daysLeft <= 3
          ? `Пробный период заканчивается через ${daysLeft} дн. Выберите тариф.`
          : null,
      daysLeft,
    };
  }

  if (state.status === SubscriptionStatus.PAST_DUE) {
    const graceEnd = state.graceEndsAt;
    if (graceEnd && graceEnd <= now) {
      return {
        level: AccessLevel.READ_ONLY,
        message: "Льготный период закончился. Новые сессии не запускаются.",
        daysLeft: 0,
      };
    }
    const daysLeft = graceEnd ? daysBetween(now, graceEnd) : GRACE_DAYS;
    return {
      level: AccessLevel.WARNING,
      message: `Счёт не оплачен. Зал работает ещё ${daysLeft} дн.`,
      daysLeft,
    };
  }

  // ACTIVE: предупреждаем заранее, чтобы платёж не догонял смену.
  const periodEnd = state.currentPeriodEnd;
  if (!periodEnd) return { level: AccessLevel.FULL, message: null, daysLeft: null };

  const daysLeft = daysBetween(now, periodEnd);
  return {
    level: daysLeft <= 3 ? AccessLevel.WARNING : AccessLevel.FULL,
    message: daysLeft <= 3 ? `Подписка продлевается через ${daysLeft} дн.` : null,
    daysLeft,
  };
}

/** Можно ли подключить ещё одну машину. */
export function canAddComputer(
  state: SubscriptionState,
  currentComputers: number,
): { allowed: boolean; message: string | null } {
  if (currentComputers < state.maxComputers) return { allowed: true, message: null };

  return {
    allowed: false,
    message:
      `Тариф рассчитан на ${state.maxComputers} машин, они уже подключены. ` +
      "Перейдите на тариф побольше, чтобы добавить ещё.",
  };
}

/** Сумма счёта за период: платим за подключённые машины. */
export function invoiceAmount(plan: SubscriptionPlan, computers: number): number {
  return PLANS[plan].pricePerComputer * computers;
}
