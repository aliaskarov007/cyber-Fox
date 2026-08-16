/** Клиент серверного API. Токен живёт в localStorage: кассовый экран не закрывают всю смену. */

const TOKEN_KEY = "cyberfox.token";

export interface Staff {
  id: string;
  tenantId: string;
  clubId: string | null;
  email: string;
  fullName: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  tenant: { name: string; sharedBalance: boolean };
}

export interface Club {
  id: string;
  name: string;
  city: string | null;
  creditLimit: number;
  packageValidityDays: number;
  lowBalanceWarnMinutes: number;
}

export interface Zone {
  id: string;
  name: string;
  sortOrder: number;
  defaultPerMinuteTariffId: string | null;
}

export interface Tariff {
  id: string;
  zoneId: string;
  name: string;
  kind: "PACKAGE" | "PER_MINUTE";
  pricePerMinute: number | null;
  packageMinutes: number | null;
  packagePrice: number | null;
  validityDays: number | null;
  activeFromMinute: number | null;
  activeToMinute: number | null;
  isActive: boolean;
}

export interface Guest {
  id: string;
  fullName: string;
  phone: string;
  bonusPoints: number;
  hasPin: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string | null;
  price: number;
  cost: number;
  stock: number | null;
  isActive: boolean;
}

export interface Shift {
  id: string;
  staffId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  cashExpected: number | null;
  cashCounted: number | null;
  note: string | null;
}

export interface ShiftReport {
  shift: Shift;
  staffName: string;
  cashExpected: number;
  cardTotal: number;
  balanceTotal: number;
  revenue: number;
  sessionsRevenue: number;
  productsRevenue: number;
  productsCost: number;
  topUpsTotal: number;
  sessionsCount: number;
  reconciliation: {
    expected: number;
    counted: number;
    difference: number;
    status: "MATCH" | "SHORTAGE" | "SURPLUS";
  } | null;
}

export interface GuestHistory {
  sessions: Array<{
    id: string;
    computerName: string;
    zoneName: string;
    startedAt: string;
    endedAt: string | null;
    totalCharged: number;
    startedBy: "GUEST" | "STAFF";
  }>;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    comment: string | null;
    createdAt: string;
    /** Сколько поминутных списаний схлопнуто в строку визита. */
    minutes: number | null;
  }>;
  packages: Array<{
    id: string;
    zoneName: string;
    minutesTotal: number;
    minutesRemaining: number;
    pricePaid: number;
    purchasedAt: string;
    expiresAt: string;
    status: string;
  }>;
}

export interface GuestPackage {
  id: string;
  zoneId: string;
  minutesRemaining: number;
  minutesTotal: number;
  expiresAt: string;
}

export interface GuestCard {
  guest: Guest;
  balance: number;
  walletClubId: string | null;
  packages: GuestPackage[];
}

export interface HallCell {
  computer: {
    id: string;
    name: string;
    status: "OFFLINE" | "IDLE" | "IN_USE" | "RESERVED" | "MAINTENANCE";
    zone: { id: string; name: string };
    lastSeenAt: string | null;
  };
  session: {
    id: string;
    status: "ACTIVE" | "PAUSED";
    startedAt: string;
    startedBy: "GUEST" | "STAFF";
    totalCharged: number;
    guest: { id: string; fullName: string; phone: string } | null;
    mode: "PACKAGE" | "PER_MINUTE" | null;
    packageMinutesLeft: number | null;
    balance: number | null;
    creditLeft: number | null;
    minutesAffordable: number | null;
    onCredit: boolean;
  } | null;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(message ?? `Ошибка ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; staff: Staff }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<Staff>("/auth/me"),

  clubs: () => request<Club[]>("/clubs"),

  zones: (clubId: string) => request<Zone[]>(`/clubs/${clubId}/zones`),

  tariffs: (clubId: string) => request<Tariff[]>(`/clubs/${clubId}/tariffs`),

  hall: (clubId: string) => request<HallCell[]>(`/clubs/${clubId}/hall`),

  searchGuests: (clubId: string, query: string) =>
    request<Guest[]>(`/clubs/${clubId}/guests?q=${encodeURIComponent(query)}`),

  guestCard: (clubId: string, guestId: string) =>
    request<GuestCard>(`/clubs/${clubId}/guests/${guestId}`),

  createGuest: (clubId: string, body: { fullName: string; phone: string; pin?: string }) =>
    request<Guest>(`/clubs/${clubId}/guests`, { method: "POST", body: JSON.stringify(body) }),

  topUp: (clubId: string, guestId: string, amount: number, method: string) =>
    request<{ balance: number }>(`/clubs/${clubId}/guests/${guestId}/topup`, {
      method: "POST",
      body: JSON.stringify({ amount, method }),
    }),

  buyPackage: (clubId: string, guestId: string, tariffId: string, method: string) =>
    request<GuestPackage>(`/clubs/${clubId}/guests/${guestId}/packages`, {
      method: "POST",
      body: JSON.stringify({ tariffId, method }),
    }),

  startSession: (
    clubId: string,
    body: { computerId: string; guestId?: string; tariffId?: string; prepaidAmount?: number },
  ) =>
    request<{ id: string }>(`/clubs/${clubId}/sessions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  stopSession: (clubId: string, sessionId: string) =>
    request<unknown>(`/clubs/${clubId}/sessions/${sessionId}/stop`, { method: "POST" }),

  pauseSession: (clubId: string, sessionId: string) =>
    request<unknown>(`/clubs/${clubId}/sessions/${sessionId}/pause`, { method: "POST" }),

  resumeSession: (clubId: string, sessionId: string) =>
    request<unknown>(`/clubs/${clubId}/sessions/${sessionId}/resume`, { method: "POST" }),

  moveSession: (clubId: string, sessionId: string, computerId: string) =>
    request<unknown>(`/clubs/${clubId}/sessions/${sessionId}/move`, {
      method: "POST",
      body: JSON.stringify({ computerId }),
    }),

  guestHistory: (clubId: string, guestId: string) =>
    request<GuestHistory>(`/clubs/${clubId}/guests/${guestId}/history`),

  products: (clubId: string) => request<Product[]>(`/clubs/${clubId}/products`),

  sellProduct: (
    clubId: string,
    body: { productId: string; quantity: number; method: string; guestId?: string; sessionId?: string },
  ) => request<unknown>(`/clubs/${clubId}/products/sell`, { method: "POST", body: JSON.stringify(body) }),

  currentShift: (clubId: string) => request<Shift | null>(`/clubs/${clubId}/shifts/current`),

  shifts: (clubId: string) => request<Shift[]>(`/clubs/${clubId}/shifts`),

  openShift: (clubId: string, openingFloat: number) =>
    request<Shift>(`/clubs/${clubId}/shifts/open`, {
      method: "POST",
      body: JSON.stringify({ openingFloat }),
    }),

  shiftReport: (clubId: string, shiftId: string) =>
    request<ShiftReport>(`/clubs/${clubId}/shifts/${shiftId}/report`),

  closeShift: (clubId: string, shiftId: string, cashCounted: number, note?: string) =>
    request<ShiftReport>(`/clubs/${clubId}/shifts/${shiftId}/close`, {
      method: "POST",
      body: JSON.stringify({ cashCounted, note }),
    }),
};

/** Тенге, введённые на стойке → тиын для сервера. */
export function toTiyn(tenge: string): number {
  return Math.round(Number(tenge.replace(",", ".")) * 100);
}

/** Тиын → строка в тенге. Все суммы приходят целыми в тиын. */
export function formatMoney(tiyn: number): string {
  const tenge = tiyn / 100;
  return `${tenge.toLocaleString("ru-KZ", { maximumFractionDigits: 2 })} ₸`;
}

export function formatDuration(fromIso: string): string {
  const minutes = Math.floor((Date.now() - new Date(fromIso).getTime()) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}
