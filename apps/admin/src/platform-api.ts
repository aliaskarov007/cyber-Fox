/**
 * Платформенная часть: свой вход и свой токен.
 *
 * Хранится отдельно от кассового: это разные люди с разными правами, и один не
 * должен подхватывать сессию другого, случайно оказавшись за тем же экраном.
 */

const TOKEN_KEY = "cyberfox.platform.token";

export interface PlatformTenant {
  id: string;
  name: string;
  createdAt: string;
  clubs: Array<{ id: string; name: string; city: string | null }>;
  plan: "TRIAL" | "BASIC" | "PRO" | null;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | null;
  maxComputers: number | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  computers: number;
  online: number;
  guests: number;
  lastSessionAt: string | null;
}

export function getPlatformToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPlatformToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getPlatformToken();
  const response = await fetch(`/api/platform${path}`, {
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

  const body = await response.text();
  return (body.length > 0 ? JSON.parse(body) : undefined) as T;
}

export const platformApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; name: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  tenants: () => request<PlatformTenant[]>("/tenants"),

  createTenant: (body: {
    networkName: string;
    clubName: string;
    city?: string;
    ownerName: string;
    email: string;
    password: string;
  }) => request<{ tenantId: string }>("/tenants", { method: "POST", body: JSON.stringify(body) }),

  updateSubscription: (
    tenantId: string,
    body: Partial<{ plan: string; status: string; maxComputers: number; trialDays: number }>,
  ) =>
    request<unknown>(`/tenants/${tenantId}/subscription`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
