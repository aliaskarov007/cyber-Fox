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
  /** Процент от потраченного, возвращаемый бонусами. 0 — программа выключена. */
  bonusPercent: number;
  /** Ключ клуба для бездисковых залов: кладётся в общий образ рядом с агентом. */
  enrollmentKey: string;
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

/**
 * Что отправляет форма тарифа.
 *
 * null здесь значит «очистить поле»: при смене вида тарифа старые значения надо
 * стереть, иначе у поминутного останутся минуты пакета. Проверки сервера
 * помечены @IsOptional и null пропускают, а Prisma по нему обнуляет колонку.
 */
export interface TariffInput {
  name: string;
  zoneId: string;
  kind: "PACKAGE" | "PER_MINUTE";
  pricePerMinute?: number | null;
  packageMinutes?: number | null;
  packagePrice?: number | null;
  validityDays?: number | null;
  activeFromMinute?: number | null;
  activeToMinute?: number | null;
}

export interface Guest {
  id: string;
  fullName: string;
  phone: string;
  bonusPoints: number;
  hasPin: boolean;
}

export interface Computer {
  id: string;
  clubId: string;
  zoneId: string;
  name: string;
  /** Место на плане зала; пусто у нерасставленных. */
  posX: number | null;
  posY: number | null;
  status: "OFFLINE" | "IDLE" | "IN_USE" | "RESERVED" | "MAINTENANCE";
  /** Код привязки агента к машине. Показывается при установке. */
  pairingToken: string | null;
  lastSeenAt: string | null;
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

/** Игра или программа на полке оболочки, которую видит гость после оплаты. */
export interface ClubApp {
  id: string;
  zoneId: string | null;
  name: string;
  category: string | null;
  kind: "EXECUTABLE" | "URI";
  target: string;
  args: string[];
  coverUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Игра, найденная агентом на машине зала, но ещё не поставленная на полку. */
export interface AppSuggestion {
  id: string;
  name: string;
  kind: "EXECUTABLE" | "URI";
  target: string;
  coverUrl: string | null;
  seenAt: string;
}

export interface ClubAppInput {
  name: string;
  category?: string;
  kind?: "EXECUTABLE" | "URI";
  target: string;
  args?: string[];
  coverUrl?: string;
  zoneId?: string | null;
  sortOrder?: number;
}

/** Что отправляет форма товара. Деньги в тиын, остаток пустой — учёта нет. */
export interface ProductInput {
  name: string;
  category?: string;
  price: number;
  cost?: number;
  stock?: number;
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
    posX: number | null;
    posY: number | null;
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

  // Пустое тело — законный ответ: например, «открытой смены нет» приходит как
  // null без содержимого. Разбирать его как JSON нельзя.
  const body = await response.text();
  return (body.length > 0 ? JSON.parse(body) : undefined) as T;
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

  createTariff: (clubId: string, body: TariffInput) =>
    request<Tariff>(`/clubs/${clubId}/tariffs`, { method: "POST", body: JSON.stringify(body) }),

  updateTariff: (clubId: string, tariffId: string, body: Partial<TariffInput> & { isActive?: boolean }) =>
    request<Tariff>(`/clubs/${clubId}/tariffs/${tariffId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createZone: (clubId: string, body: { name: string; sortOrder?: number }) =>
    request<Zone>(`/clubs/${clubId}/zones`, { method: "POST", body: JSON.stringify(body) }),

  updateZone: (
    clubId: string,
    zoneId: string,
    body: Partial<{ name: string; sortOrder: number; defaultPerMinuteTariffId: string }>,
  ) =>
    request<Zone>(`/clubs/${clubId}/zones/${zoneId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  computers: (clubId: string) => request<Computer[]>(`/clubs/${clubId}/computers`),

  createComputer: (clubId: string, body: { name: string; zoneId: string }) =>
    request<Computer>(`/clubs/${clubId}/computers`, { method: "POST", body: JSON.stringify(body) }),

  updateComputer: (
    clubId: string,
    computerId: string,
    body: Partial<{ name: string; zoneId: string; posX: number | null; posY: number | null }>,
  ) =>
    request<Computer>(`/clubs/${clubId}/computers/${computerId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  hall: (clubId: string) => request<HallCell[]>(`/clubs/${clubId}/hall`),

  searchGuests: (clubId: string, query: string) =>
    request<Guest[]>(`/clubs/${clubId}/guests?q=${encodeURIComponent(query)}`),

  guestCard: (clubId: string, guestId: string) =>
    request<GuestCard>(`/clubs/${clubId}/guests/${guestId}`),

  createGuest: (clubId: string, body: { fullName: string; phone: string; pin?: string }) =>
    request<Guest>(`/clubs/${clubId}/guests`, { method: "POST", body: JSON.stringify(body) }),

  apps: (clubId: string) => request<ClubApp[]>(`/clubs/${clubId}/apps`),

  createApp: (clubId: string, body: ClubAppInput) =>
    request<ClubApp>(`/clubs/${clubId}/apps`, { method: "POST", body: JSON.stringify(body) }),

  updateApp: (clubId: string, appId: string, body: Partial<ClubAppInput> & { isActive?: boolean }) =>
    request<ClubApp>(`/clubs/${clubId}/apps/${appId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * Обложка файлом. Заголовок Content-Type не ставим намеренно: браузер сам
   * добавит границу раздела частей, а заданный руками её потеряет.
   */
  uploadCover: async (clubId: string, file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const response = await fetch(`/api/clubs/${clubId}/uploads/cover`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `Ошибка ${response.status}`);
    }
    return (await response.json()) as { url: string };
  },

  appSuggestions: (clubId: string) => request<AppSuggestion[]>(`/clubs/${clubId}/apps/suggestions`),

  acceptSuggestions: (clubId: string, ids: string[]) =>
    request<{ added: number }>(`/clubs/${clubId}/apps/suggestions/accept`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  dismissSuggestion: (clubId: string, id: string) =>
    request<{ ok: true }>(`/clubs/${clubId}/apps/suggestions/${id}`, { method: "DELETE" }),

  deleteApp: (clubId: string, appId: string) =>
    request<{ ok: true }>(`/clubs/${clubId}/apps/${appId}`, { method: "DELETE" }),

  createProduct: (clubId: string, body: ProductInput) =>
    request<Product>(`/clubs/${clubId}/products`, { method: "POST", body: JSON.stringify(body) }),

  updateProduct: (clubId: string, productId: string, body: Partial<ProductInput> & { isActive?: boolean }) =>
    request<Product>(`/clubs/${clubId}/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** PIN гостя для самостоятельного входа за игровым ПК. Хранится хешем. */
  setGuestPin: (clubId: string, guestId: string, pin: string) =>
    request<{ ok: true }>(`/clubs/${clubId}/guests/${guestId}/pin`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),

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

  // --- Сеть клубов ---

  tenant: () => request<Tenant>("/network/tenant"),

  updateTenant: (body: { name?: string; sharedBalance?: boolean; moveBalancesToClubId?: string }) =>
    request<Tenant>("/network/tenant", { method: "PATCH", body: JSON.stringify(body) }),

  createClub: (body: { name: string; city?: string; timezone?: string }) =>
    request<Club>("/network/clubs", { method: "POST", body: JSON.stringify(body) }),

  updateClub: (
    clubId: string,
    body: Partial<{
      name: string;
      city: string;
      creditLimit: number;
      packageValidityDays: number;
      lowBalanceWarnMinutes: number;
      bonusPercent: number;
    }>,
  ) => request<Club>(`/network/clubs/${clubId}`, { method: "PATCH", body: JSON.stringify(body) }),

  staff: () => request<StaffMember[]>("/network/staff"),

  createStaff: (body: {
    email: string;
    fullName: string;
    password: string;
    role: string;
    clubId?: string;
  }) => request<StaffMember>("/network/staff", { method: "POST", body: JSON.stringify(body) }),

  updateStaff: (
    staffId: string,
    body: Partial<{ fullName: string; password: string; role: string; clubId: string; isActive: boolean }>,
  ) => request<StaffMember>(`/network/staff/${staffId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // --- Отчёты ---

  networkReport: (period: { from?: string; to?: string } = {}) =>
    request<ClubSummary[]>(`/reports/network${periodQuery(period)}`),

  settlement: (period: { from?: string; to?: string } = {}) =>
    request<Settlement>(`/reports/settlement${periodQuery(period)}`),

  computerReport: (clubId: string, period: { from?: string; to?: string } = {}) =>
    request<ComputerPerformance[]>(`/reports/clubs/${clubId}/computers${periodQuery(period)}`),

  hoursReport: (clubId: string, period: { from?: string; to?: string } = {}) =>
    request<HourlyPoint[]>(`/reports/clubs/${clubId}/hours${periodQuery(period)}`),

  // --- Подписка на платформу ---

  signup: (body: SignupBody) =>
    request<{ accessToken: string; staff: Staff; clubId: string }>("/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  subscription: () => request<SubscriptionInfo>("/subscription"),

  platformInvoices: () => request<Invoice[]>("/subscription/invoices"),

  changePlan: (plan: string) =>
    request<unknown>("/subscription/plan", { method: "POST", body: JSON.stringify({ plan }) }),

  // --- Касса: онлайн-оплата ---

  createOnlineTopUp: (clubId: string, guestId: string, amount: number) =>
    request<Checkout>(`/clubs/${clubId}/guests/${guestId}/online-topup`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  confirmPayment: (intentId: string) =>
    request<{ applied: boolean; reason: string | null }>(`/payments/${intentId}/confirm`, {
      method: "POST",
    }),

  payInvoice: (invoiceId: string) =>
    request<Checkout>(`/subscription/invoices/${invoiceId}/pay`, { method: "POST" }),

  // --- Перенос данных ---

  importCsv: (clubId: string, kind: "guests" | "computers" | "tariffs", csv: string) =>
    request<ImportResult>(`/clubs/${clubId}/import/${kind}`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
};

export interface PlanDefinition {
  plan: "TRIAL" | "BASIC" | "PRO";
  title: string;
  maxComputers: number;
  pricePerComputer: number;
  multiClub: boolean;
}

export interface SubscriptionInfo {
  subscription: {
    plan: "TRIAL" | "BASIC" | "PRO";
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
    maxComputers: number;
    pricePerComputer: number;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
  };
  access: {
    level: "FULL" | "WARNING" | "READ_ONLY";
    message: string | null;
    daysLeft: number | null;
  };
  plans: PlanDefinition[];
}

export interface Invoice {
  id: string;
  periodStart: string;
  periodEnd: string;
  computers: number;
  amount: number;
  status: "ISSUED" | "PAID" | "OVERDUE" | "VOID";
  dueAt: string;
  paidAt: string | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  problems: Array<{ line: number; reason: string }>;
}

export interface Checkout {
  intentId: string;
  amount: number;
  /** Ссылка на оплату; пусто — провайдер не настроен, платят на стойке. */
  url: string | null;
  qrPayload: string | null;
  provider: string;
}

export interface SignupBody {
  clubName: string;
  city?: string;
  ownerName: string;
  email: string;
  password: string;
  computers?: number;
  pricePerMinute?: number;
}

function periodQuery(period: { from?: string; to?: string }): string {
  const params = new URLSearchParams();
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export interface Tenant {
  id: string;
  name: string;
  sharedBalance: boolean;
}

export interface StaffMember {
  id: string;
  clubId: string | null;
  email: string;
  fullName: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  isActive: boolean;
}

export interface ClubSummary {
  clubId: string;
  clubName: string;
  revenue: number;
  sessionsRevenue: number;
  productsRevenue: number;
  productsMargin: number;
  sessionsCount: number;
  busyMinutes: number;
  computers: number;
  occupancy: number;
}

export interface ComputerPerformance {
  computerId: string;
  computerName: string;
  zoneName: string;
  revenue: number;
  minutes: number;
  sessions: number;
  occupancy: number;
  revenuePerBusyHour: number;
}

export interface HourlyPoint {
  hour: number;
  revenue: number;
  sessions: number;
}

export interface Settlement {
  sharedBalance: boolean;
  guestFundsChange: number;
  rows: Array<{
    clubId: string;
    clubName: string;
    collected: number;
    consumed: number;
    balance: number;
  }>;
}

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
