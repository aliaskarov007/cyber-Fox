export const StaffRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  STAFF: "STAFF",
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

export const ComputerStatus = {
  OFFLINE: "OFFLINE",
  IDLE: "IDLE",
  IN_USE: "IN_USE",
  RESERVED: "RESERVED",
  MAINTENANCE: "MAINTENANCE",
} as const;
export type ComputerStatus = (typeof ComputerStatus)[keyof typeof ComputerStatus];

export const SessionStatus = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  FINISHED: "FINISHED",
  CANCELLED: "CANCELLED",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** Вид тарифа: пакет минут за фиксированную цену либо поминутная оплата. */
export const TariffKind = {
  PACKAGE: "PACKAGE",
  PER_MINUTE: "PER_MINUTE",
} as const;
export type TariffKind = (typeof TariffKind)[keyof typeof TariffKind];

/** Почему закрылся тарифицированный отрезок сессии. */
export const SegmentEndReason = {
  PACKAGE_EXHAUSTED: "PACKAGE_EXHAUSTED",
  CREDIT_LIMIT: "CREDIT_LIMIT",
  ZONE_CHANGE: "ZONE_CHANGE",
  TARIFF_SCHEDULE: "TARIFF_SCHEDULE",
  STOPPED_BY_STAFF: "STOPPED_BY_STAFF",
  PAUSED: "PAUSED",
} as const;
export type SegmentEndReason = (typeof SegmentEndReason)[keyof typeof SegmentEndReason];

export const TransactionType = {
  TOPUP: "TOPUP",
  SESSION_CHARGE: "SESSION_CHARGE",
  PRODUCT_SALE: "PRODUCT_SALE",
  REFUND: "REFUND",
  ADJUSTMENT: "ADJUSTMENT",
  DEBT_WRITE_OFF: "DEBT_WRITE_OFF",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

/** Уровень связи, в котором находится зал. См. docs/offline.md. */
export const ConnectivityLevel = {
  /** Норма: облако доступно. */
  ONLINE: "ONLINE",
  /** Облако недоступно, локальная сеть жива — аварийный режим через локальный узел. */
  LOCAL_ONLY: "LOCAL_ONLY",
  /** Агент изолирован: доигрывает оплаченное время в одиночку. */
  ISOLATED: "ISOLATED",
} as const;
export type ConnectivityLevel = (typeof ConnectivityLevel)[keyof typeof ConnectivityLevel];
