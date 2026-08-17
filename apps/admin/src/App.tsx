import { useEffect, useState } from "react";

import { type Club, type Staff, api, getToken, setToken } from "./api.js";
import { BarScreen } from "./BarScreen.js";
import { GuestsScreen } from "./GuestsScreen.js";
import { HallScreen } from "./HallScreen.js";
import { LoginScreen } from "./LoginScreen.js";
import { NetworkScreen } from "./NetworkScreen.js";
import { OnboardingScreen } from "./OnboardingScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { ShiftBar } from "./ShiftBar.js";
import { SignupScreen } from "./SignupScreen.js";
import { TariffsScreen } from "./TariffsScreen.js";

/** Вкладки верхнего меню. Экспортируется, чтобы экраны могли отправить админа
 *  туда, где продолжается начатое: «заведите машины» → «Настройки». */
export type Tab =
  | "hall"
  | "bar"
  | "guests"
  | "tariffs"
  | "network"
  | "onboarding"
  | "settings";

const TABS: Array<{ id: Tab; label: string; ownerOnly?: boolean }> = [
  { id: "hall", label: "Зал" },
  { id: "bar", label: "Бар" },
  { id: "guests", label: "Гости" },
  { id: "tariffs", label: "Тарифы" },
  { id: "network", label: "Сеть", ownerOnly: true },
  { id: "onboarding", label: "Подключение" },
  { id: "settings", label: "Настройки" },
];

export function App() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("hall");
  const [loading, setLoading] = useState(true);
  const [signingUp, setSigningUp] = useState(false);

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

  if (loading) return <div className="login-wrap">Загружаем…</div>;
  if (!staff) {
    return signingUp ? (
      <SignupScreen onDone={() => void load()} onBack={() => setSigningUp(false)} />
    ) : (
      <LoginScreen onDone={() => void load()} onSignup={() => setSigningUp(true)} />
    );
  }

  const club = clubs.find((c) => c.id === clubId) ?? null;

  return (
    <>
      <header className="topbar">
        <span className="brand">
          Cyber-<span>Fox</span>
        </span>

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
          <span style={{ color: "var(--muted)" }}>{club?.name}</span>
        )}

        <nav className="link-tabs">
          {/* Сводка по сети — забота владельца; управляющему она не нужна. */}
          {TABS.filter((item) => !item.ownerOnly || staff.role === "OWNER").map((item) => (
            <button
              key={item.id}
              aria-current={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <span className="spacer" />

        {club && <ShiftBar club={club} />}

        <span className="who">
          {staff.fullName}
          <br />
          {staff.tenant.name}
        </span>
        <button
          onClick={() => {
            setToken(null);
            setStaff(null);
          }}
        >
          Выйти
        </button>
      </header>

      {club === null ? (
        <main>
          <div className="notice">Нет доступных клубов.</div>
        </main>
      ) : tab === "hall" ? (
        <HallScreen club={club} onGoTo={setTab} />
      ) : tab === "bar" ? (
        <BarScreen club={club} />
      ) : tab === "guests" ? (
        <GuestsScreen club={club} />
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
        <TariffsScreen club={club} />
      )}
    </>
  );
}
