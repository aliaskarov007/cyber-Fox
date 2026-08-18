import { type FormEvent, useEffect, useState } from "react";

import { type PlatformTenant, platformApi, setPlatformToken } from "./platform-api.js";
import { PlatformTenantForm } from "./PlatformTenantForm.js";

const PLAN_LABEL: Record<string, string> = { TRIAL: "Пробный", BASIC: "Один зал", PRO: "Сеть залов" };
const STATUS_LABEL: Record<string, string> = {
  TRIALING: "пробный период",
  ACTIVE: "платит",
  PAST_DUE: "просрочен",
  SUSPENDED: "остановлен",
  CANCELED: "отменён",
};

/** Сколько дней осталось до срока; отрицательное — сколько прошло после. */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function when(iso: string | null): string {
  if (!iso) return "никогда";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} дн. назад`;
}

/**
 * Обзор платформы: все сети сразу.
 *
 * Отвечает на вопросы продавца, а не администратора зала: кто зарегистрировался
 * и не вернулся, у кого кончается пробный период, где машины на связи. Тревожное
 * поднято наверх, потому что читают этот экран по диагонали.
 */
export function PlatformScreen({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      setTenants(await platformApi.tenants());
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totals = {
    clubs: tenants.reduce((sum, t) => sum + t.clubs.length, 0),
    computers: tenants.reduce((sum, t) => sum + t.computers, 0),
    online: tenants.reduce((sum, t) => sum + t.online, 0),
    paying: tenants.filter((t) => t.status === "ACTIVE").length,
  };

  return (
    <>
      <header className="topbar">
        <h1 className="brand">
          Cyber-<span>Fox</span> платформа
        </h1>
        <div className="spacer" />
        <div className="who">{name}</div>
        <button
          onClick={() => {
            setPlatformToken(null);
            onLogout();
          }}
        >
          Выйти
        </button>
      </header>

      <main>
        {error && <div className="error">{error}</div>}

        <div className="summary">
          <div className="stat">
            <div className="value">{tenants.length}</div>
            <div className="label">Сетей</div>
          </div>
          <div className="stat">
            <div className="value">{totals.clubs}</div>
            <div className="label">Клубов</div>
          </div>
          <div className="stat">
            <div className="value">
              {totals.online}/{totals.computers}
            </div>
            <div className="label">Машин на связи</div>
          </div>
          <div className="stat">
            <div className="value">{totals.paying}</div>
            <div className="label">Платят</div>
          </div>
        </div>

        <section className="zone-block">
          <div className="zone-head">
            <h2>Сети</h2>
            <button className="primary" type="button" onClick={() => setAdding((v) => !v)}>
              {adding ? "Отмена" : "Подключить клуб"}
            </button>
          </div>

          {adding && (
            <PlatformTenantForm
              onCreated={() => {
                setAdding(false);
                void load();
              }}
            />
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сеть</th>
                  <th>Клубы</th>
                  <th>Машины</th>
                  <th>Подписка</th>
                  <th>Срок</th>
                  <th>Последняя игра</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => {
                  const left = daysLeft(tenant.trialEndsAt);
                  return (
                    <tr key={tenant.id}>
                      <td>
                        <b>{tenant.name}</b>
                        <div className="note">
                          завели {when(tenant.createdAt)} · гостей {tenant.guests}
                        </div>
                      </td>
                      <td>
                        {tenant.clubs.map((club) => (
                          <div key={club.id}>
                            {club.name}
                            {club.city ? ` · ${club.city}` : ""}
                          </div>
                        ))}
                      </td>
                      <td className="num">
                        {tenant.online}/{tenant.computers}
                        {tenant.maxComputers ? <div className="note">лимит {tenant.maxComputers}</div> : null}
                      </td>
                      <td>
                        {tenant.plan ? PLAN_LABEL[tenant.plan] : "—"}
                        <div className="note">{tenant.status ? STATUS_LABEL[tenant.status] : ""}</div>
                      </td>
                      <td className="num">
                        {/* Кончающийся пробный период — повод позвонить сегодня, а не завтра. */}
                        {left === null ? "—" : left >= 0 ? `${left} дн.` : `просрочен ${-left} дн.`}
                      </td>
                      <td className="num">{when(tenant.lastSessionAt)}</td>
                      <td className="actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => platformApi.updateSubscription(tenant.id, { trialDays: 14 }))}
                        >
                          +14 дней
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => platformApi.updateSubscription(tenant.id, { status: "ACTIVE" }))
                          }
                        >
                          Отметить оплату
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={7}>Сетей пока нет. Подключите первый клуб кнопкой выше.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}

/** Вход для платформы: отдельный от кассового намеренно. */
export function PlatformLogin({ onIn }: { onIn: (name: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await platformApi.login(email, password);
      setPlatformToken(result.accessToken);
      onIn(result.name);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="brand">
          Cyber-<span>Fox</span> платформа
        </h1>
        {error && <div className="error">{error}</div>}
        <label>
          Почта
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Войти
        </button>
      </form>
    </div>
  );
}
