import { useEffect, useState } from "react";

import { type Club, type Staff, api, getToken, setToken } from "./api.js";
import { AnalyticsScreen } from "./AnalyticsScreen.js";
import { BarScreen } from "./BarScreen.js";
import { FinanceScreen } from "./FinanceScreen.js";
import { ReservationsScreen } from "./ReservationsScreen.js";
import { DashboardScreen } from "./DashboardScreen.js";
import { EventsScreen } from "./EventsScreen.js";
import { PlatformLogin, PlatformScreen } from "./PlatformScreen.js";
import { getPlatformToken } from "./platform-api.js";
import { LibraryScreen } from "./LibraryScreen.js";
import { GuestsScreen } from "./GuestsScreen.js";
import { HallScreen } from "./HallScreen.js";
import { ForgotPasswordScreen } from "./ForgotPasswordScreen.js";
import { LoginScreen } from "./LoginScreen.js";
import { NetworkScreen } from "./NetworkScreen.js";
import { OnboardingScreen } from "./OnboardingScreen.js";
import { PromosScreen } from "./PromosScreen.js";
import { RetentionScreen } from "./RetentionScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { ShiftBar } from "./ShiftBar.js";
import { SignupScreen } from "./SignupScreen.js";
import { TariffsScreen } from "./TariffsScreen.js";

/** Вкладки верхнего меню. Экспортируется, чтобы экраны могли отправить админа
 *  туда, где продолжается начатое: «заведите машины» → «Настройки». */
export type Tab =
  | "dashboard"
  | "analytics"
  | "finance"
  | "hall"
  | "bar"
  | "guests"
  | "reservations"
  | "events"
  | "promos"
  | "retention"
  | "tariffs"
  | "library"
  | "network"
  | "onboarding"
  | "settings";

/*
 * Кассир (STAFF) видит только то, что нужно на стойке: смену, карту клуба, бар,
 * гостей, промокоды и тарифы (последние два — лишь на просмотр). Остальное —
 * настройки клуба, подключение, ивенты, отчёты — забота владельца и
 * управляющего. Список намеренно «белый»: новая вкладка по умолчанию не
 * открывается кассиру, пока её сюда не внесут.
 */
const CASHIER_TABS: Tab[] = [
  "dashboard",
  "hall",
  "bar",
  "guests",
  "reservations",
  "promos",
  "tariffs",
];

const TABS: Array<{
  id: Tab;
  label: string;
  ownerOnly?: boolean;
  manageOnly?: boolean;
}> = [
  { id: "dashboard", label: "Смена" },
  // Аналитика по периоду — забота владельца и управляющего, не кассира.
  { id: "analytics", label: "Аналитика", manageOnly: true },
  { id: "finance", label: "Финансы", manageOnly: true },
  { id: "hall", label: "Карта клуба" },
  { id: "bar", label: "Бар" },
  { id: "guests", label: "Гости" },
  { id: "reservations", label: "Бронь" },
  { id: "events", label: "Ивенты" },
  { id: "promos", label: "Промокоды" },
  // Отчёт — список номеров с тратами, рассылка раздаёт деньги: сервер закрывает ролью.
  { id: "retention", label: "Отток", manageOnly: true },
  { id: "tariffs", label: "Тарифы" },
  // Витрину зала собирает владелец или управляющий: сервер закрывает правку ролью.
  { id: "library", label: "Игры", manageOnly: true },
  { id: "network", label: "Сеть", ownerOnly: true },
  { id: "onboarding", label: "Подключение" },
  { id: "settings", label: "Настройки" },
];

/*
 * Платформенная часть живёт по своему адресу и со своим входом. Разделение
 * намеренное: это разные люди с разными правами, и путать их экраны нельзя —
 * кассир не должен случайно увидеть чужие клубы.
 */
export function App() {
  if (window.location.pathname.startsWith("/platform")) return <PlatformApp />;
  return <ClubApp />;
}

function PlatformApp() {
  const [name, setName] = useState<string | null>(
    getPlatformToken() ? "Платформа" : null,
  );
  if (!name) return <PlatformLogin onIn={setName} />;
  return <PlatformScreen name={name} onLogout={() => setName(null)} />;
}

function ClubApp() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  // Гость, чью карточку открыть при переходе в «Гости» (из зала — «Открыть аккаунт»).
  const [focusGuestId, setFocusGuestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingUp, setSigningUp] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  async function load(): Promise<void> {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    try {
      const [me, list] = await Promise.all([api.me(), api.clubs()]);
      setStaff(me);
      setClubs(list);
      setClubId((current) => current ?? list[0]?.id ?? null);
      // Запоминаем клуб на этом ПК — для быстрого входа кассиров по ПИН.
      try {
        if (me.clubId) localStorage.setItem("fx_pin_club", me.clubId);
      } catch {
        // Хранилище недоступно — быстрый вход просто не появится.
      }
    } catch {
      // Просроченный токен не должен запирать экран: возвращаем форму входа.
      setToken(null);
      setStaff(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Кассира нельзя оставить на скрытой вкладке: если дочерний экран увёл его
  // в недоступный раздел (напр. onGoTo в «Настройки»), возвращаем на «Смену».
  useEffect(() => {
    if (staff?.role === "STAFF" && !CASHIER_TABS.includes(tab)) {
      setTab("dashboard");
    }
  }, [staff, tab]);

  if (loading) return <div className="login-wrap">Загружаем…</div>;
  if (!staff) {
    if (signingUp) {
      return (
        <SignupScreen
          onDone={() => void load()}
          onBack={() => setSigningUp(false)}
        />
      );
    }
    if (forgot) {
      return (
        <ForgotPasswordScreen
          onBack={() => setForgot(false)}
          onDone={() => {
            setForgot(false);
            setNotice("Пароль изменён — войдите с новым паролем");
          }}
        />
      );
    }
    return (
      <LoginScreen
        notice={notice}
        onDone={() => void load()}
        onSignup={() => setSigningUp(true)}
        onForgot={() => {
          setNotice(null);
          setForgot(true);
        }}
      />
    );
  }

  const club = clubs.find((c) => c.id === clubId) ?? null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <span className="brand">
          Cyber-<span>Fox</span>
        </span>
        <nav className="side-nav">
          {/* Кассиру — только разделы стойки; владельцу и управляющему — по роли. */}
          {TABS.filter((item) =>
            staff.role === "STAFF"
              ? CASHIER_TABS.includes(item.id)
              : (!item.ownerOnly || staff.role === "OWNER") &&
                (!item.manageOnly ||
                  staff.role === "OWNER" ||
                  staff.role === "ADMIN"),
          ).map((item) => (
            <button
              key={item.id}
              className="side-link"
              aria-current={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          {/* Владелец сети переключается между залами; у остальных зал один. */}
          {clubs.length > 1 ? (
            <select
              style={{ width: 220 }}
              value={clubId ?? ""}
              onChange={(e) => setClubId(e.target.value)}
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="club-name">{club?.name}</span>
          )}

          <span className="spacer" />

          {club && <ShiftBar club={club} staff={staff} />}

          <span className="who">
            {staff.fullName}
            <br />
            {staff.tenant.name}
          </span>
          <button onClick={() => setPinOpen(true)}>ПИН</button>
          <button
            onClick={() => {
              setToken(null);
              setStaff(null);
            }}
          >
            Выйти
          </button>
        </header>

        {pinOpen && <PinSetter onClose={() => setPinOpen(false)} />}

        {club === null ? (
          <main>
            <div className="notice">Нет доступных клубов.</div>
          </main>
        ) : tab === "dashboard" ? (
          <DashboardScreen club={club} />
        ) : tab === "analytics" ? (
          <AnalyticsScreen club={club} clubs={clubs} />
        ) : tab === "finance" ? (
          <FinanceScreen club={club} />
        ) : tab === "reservations" ? (
          <ReservationsScreen club={club} />
        ) : tab === "hall" ? (
          <HallScreen
            club={club}
            staff={staff}
            onGoTo={setTab}
            onOpenGuest={(id) => {
              setFocusGuestId(id);
              setTab("guests");
            }}
          />
        ) : tab === "bar" ? (
          <BarScreen club={club} staff={staff} />
        ) : tab === "guests" ? (
          <GuestsScreen
            club={club}
            staff={staff}
            focusGuestId={focusGuestId}
            onFocusConsumed={() => setFocusGuestId(null)}
          />
        ) : tab === "events" ? (
          <EventsScreen club={club} staff={staff} />
        ) : tab === "retention" ? (
          <RetentionScreen club={club} onGoTo={setTab} />
        ) : tab === "promos" ? (
          <PromosScreen club={club} staff={staff} />
        ) : tab === "library" ? (
          <LibraryScreen club={club} />
        ) : tab === "network" ? (
          <NetworkScreen clubs={clubs} />
        ) : tab === "onboarding" ? (
          <OnboardingScreen club={club} isOwner={staff.role === "OWNER"} />
        ) : tab === "settings" ? (
          <SettingsScreen
            club={club}
            staff={staff}
            clubs={clubs}
            onClubsChanged={() => void load()}
          />
        ) : (
          <TariffsScreen club={club} staff={staff} />
        )}
      </div>
    </div>
  );
}

/** Диалог установки своего ПИН для быстрого входа на кассе. */
function PinSetter({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(): Promise<void> {
    if (pin.length !== 4) {
      setError("ПИН — четыре цифры");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setMyPin(pin);
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="backdrop" aria-label="Закрыть" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Мой ПИН</h2>
        </div>
        <div className="section">
          <div className="notice">
            ПИН нужен для быстрого входа на кассовом ПК: выбрал имя — ввёл
            четыре цифры. Почта и пароль продолжают работать.
          </div>
          {error && <div className="error">{error}</div>}
          {done ? (
            <div className="notice">ПИН сохранён.</div>
          ) : (
            <>
              <input
                className="pin-input"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="● ● ● ●"
                aria-label="Новый ПИН"
              />
              <button
                className="primary"
                disabled={busy || pin.length !== 4}
                onClick={() => void save()}
              >
                Сохранить ПИН
              </button>
            </>
          )}
        </div>
        <button onClick={onClose}>Закрыть</button>
      </aside>
    </>
  );
}
