import type { BillingMode, ComputerStatus, SessionStatus, StaffRole } from "./enums.js";

export interface ClubDto {
  id: string;
  name: string;
  timezone: string;
  createdAt: string;
}

export interface ComputerDto {
  id: string;
  clubId: string;
  name: string;
  zone: string | null;
  status: ComputerStatus;
  pairingToken: string | null;
  lastSeenAt: string | null;
}

export interface TariffDto {
  id: string;
  clubId: string;
  name: string;
  mode: BillingMode;
  pricePerMinute: number | null;
  packageMinutes: number | null;
  packagePrice: number | null;
  isActive: boolean;
}

export interface ClientDto {
  id: string;
  clubId: string;
  fullName: string;
  phone: string | null;
  balance: number;
  bonusPoints: number;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  clubId: string;
  computerId: string;
  clientId: string | null;
  tariffId: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  accruedCost: number;
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

// WebSocket event contracts shared between server, admin and agent
export type ServerToAgentEvent =
  | { type: "session.started"; sessionId: string; tariffId: string; endsAt: string | null }
  | { type: "session.stopped"; sessionId: string }
  | { type: "session.tick"; sessionId: string; remainingSeconds: number | null; accruedCost: number }
  | { type: "lock" }
  | { type: "unlock" }
  | { type: "message"; text: string };

export type AgentToServerEvent =
  | { type: "hello"; pairingToken: string; hostname: string }
  | { type: "heartbeat"; computerId: string }
  | { type: "unlock.requested"; computerId: string; tariffId: string; clientId: string | null };

export type ServerToAdminEvent =
  | { type: "computer.status"; computer: ComputerDto }
  | { type: "session.updated"; session: SessionDto };
