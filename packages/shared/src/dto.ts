import type {
  ConnectivityLevel,
  ComputerStatus,
  GuestPackageStatus,
  SegmentEndReason,
  SessionStatus,
  StaffRole,
  TariffKind,
} from "./enums.js";

/**
 * Все денежные суммы — целые числа в тиын (1/100 ₸).
 * Поминутная цена часто получается делением часовой, и дробные значения
 * в плавающей точке за смену расходятся с кассой. См. docs/billing.md.
 */
export type Money = number;

export interface ClubDto {
  id: string;
  name: string;
  timezone: string;
  /** Лимит игры в долг, в тиын. Действует одинаково онлайн и офлайн. */
  creditLimit: Money;
  /** Срок жизни пакета по умолчанию; задаёт владелец клуба. */
  packageValidityDays: number;
  /** За сколько минут до конца пакета предупреждать гостя. */
  lowBalanceWarnMinutes: number;
  createdAt: string;
}

export interface ZoneDto {
  id: string;
  clubId: string;
  name: string;
  /** Тариф, на который переходит сессия при исчерпании пакета. */
  defaultPerMinuteTariffId: string | null;
  sortOrder: number;
}

export interface ComputerDto {
  id: string;
  clubId: string;
  zoneId: string;
  name: string;
  status: ComputerStatus;
  pairingToken: string | null;
  lastSeenAt: string | null;
}

export interface TariffDto {
  id: string;
  clubId: string;
  zoneId: string;
  name: string;
  kind: TariffKind;
  /** Заполнено для PER_MINUTE. */
  pricePerMinute: Money | null;
  /** Заполнены для PACKAGE. */
  packageMinutes: number | null;
  packagePrice: Money | null;
  /** Срок жизни пакета; пусто — берём packageValidityDays клуба. */
  validityDays: number | null;
  /** Для PACKAGE: чем продолжать после исчерпания. Пусто — берём тариф зоны. */
  fallbackTariffId: string | null;
  /** Окно действия по времени суток, например ночной тариф 22:00–08:00. */
  activeFrom: string | null;
  activeTo: string | null;
  daysOfWeek: number[] | null;
  isActive: boolean;
}

export interface GuestDto {
  id: string;
  clubId: string;
  fullName: string;
  phone: string | null;
  /** Может быть отрицательным — гость доигрывал в долг. */
  balance: Money;
  bonusPoints: number;
  createdAt: string;
}

/**
 * Купленный пакет минут. Живёт на аккаунте гостя, а не в сессии: переживает
 * пересадку в другую зону и конец визита. Минуты действительны только в своей зоне.
 */
export interface GuestPackageDto {
  id: string;
  clubId: string;
  guestId: string;
  zoneId: string;
  sourceTariffId: string;
  minutesTotal: number;
  minutesRemaining: number;
  pricePaid: Money;
  purchasedAt: string;
  expiresAt: string;
  status: GuestPackageStatus;
}

/** Отрезок сессии с одним тарифом. Сессия — цепочка таких отрезков. */
export interface SessionSegmentDto {
  id: string;
  sessionId: string;
  tariffId: string;
  kind: TariffKind;
  /** Для PACKAGE: из какого пакета аккаунта тратились минуты. */
  guestPackageId: string | null;
  startedAt: string;
  endedAt: string | null;
  minutesUsed: number;
  charged: Money;
  endReason: SegmentEndReason | null;
}

export interface SessionDto {
  id: string;
  clubId: string;
  computerId: string;
  zoneId: string;
  guestId: string | null;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  totalCharged: Money;
  segments: SessionSegmentDto[];
  /** Была ли сессия начата в аварийном режиме без связи с облаком. */
  startedOffline: boolean;
}

export interface StaffUserDto {
  id: string;
  clubId: string;
  email: string;
  fullName: string;
  role: StaffRole;
}

export interface LoginResponseDto {
  accessToken: string;
  user: StaffUserDto;
}

// --- Контракты событий между сервером, панелью и агентом ---

export type ServerToAgentEvent =
  | { type: "session.started"; session: SessionDto }
  | { type: "session.stopped"; sessionId: string; reason: SegmentEndReason }
  /** Регулярный тик: что показать гостю на экране. */
  | {
      type: "session.tick";
      sessionId: string;
      /** Остаток минут текущего пакета, если идёт пакетный отрезок. */
      packageMinutesLeft: number | null;
      /** Когда сгорает текущий пакет — показываем гостю, если срок близко. */
      packageExpiresAt: string | null;
      /** Баланс гостя и на сколько минут его хватит по текущему тарифу. */
      balance: Money;
      minutesAffordable: number | null;
      /** Сколько кредита осталось, когда баланс уже отрицательный. */
      creditLeft: Money | null;
      accruedCost: Money;
    }
  /** Минуты кончились, включён поминутный тариф — сессия продолжается. */
  | { type: "session.switchedToPerMinute"; sessionId: string; tariffId: string; pricePerMinute: Money }
  /** Один пакет исчерпан, но в зоне есть следующий — продолжаем на нём. */
  | { type: "session.switchedToPackage"; sessionId: string; guestPackageId: string; minutesLeft: number }
  | { type: "lock" }
  | { type: "unlock" }
  | { type: "message"; text: string };

export type AgentToServerEvent =
  | { type: "hello"; pairingToken: string; hostname: string }
  | { type: "heartbeat"; computerId: string; connectivity: ConnectivityLevel }
  | { type: "unlock.requested"; computerId: string; tariffId: string; guestId: string | null }
  /** Досылка отрезков, накопленных без связи с облаком. */
  | { type: "offline.segments"; computerId: string; segments: OfflineOperationDto[] };

export type ServerToAdminEvent =
  | { type: "computer.status"; computer: ComputerDto }
  | { type: "session.updated"; session: SessionDto }
  /** Гость ушёл в минус — админу стоит подойти и предложить пополнение. */
  | { type: "session.onCredit"; sessionId: string; computerId: string; creditLeft: Money }
  | { type: "connectivity.changed"; level: ConnectivityLevel; queuedOperations: number };

/** Операция, выполненная без связи с облаком. UUID — ключ идемпотентности при досылке. */
export interface OfflineOperationDto {
  /** Сгенерирован локально; повторная доставка не создаёт вторую запись. */
  uuid: string;
  /** Монотонный номер узла — для восстановления порядка. */
  sequence: number;
  kind: string;
  payload: unknown;
  /** Часы устройства и последнее известное время сервера — для контроля подкрутки часов. */
  deviceTime: string;
  lastKnownServerTime: string | null;
}
