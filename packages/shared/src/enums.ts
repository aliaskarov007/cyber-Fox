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

export const BillingMode = {
  PER_MINUTE: "PER_MINUTE",
  FIXED_PACKAGE: "FIXED_PACKAGE",
} as const;
export type BillingMode = (typeof BillingMode)[keyof typeof BillingMode];

export const TransactionType = {
  TOPUP: "TOPUP",
  SESSION_CHARGE: "SESSION_CHARGE",
  PRODUCT_SALE: "PRODUCT_SALE",
  REFUND: "REFUND",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];
