import { type FormEvent, useEffect, useState } from "react";

import { type Club, type Staff, type StaffMember, type Tenant, api, formatMoney, toTiyn } from "./api.js";
import { ComputersSection } from "./ComputersSection.js";
import { ZonesSection } from "./ZonesSection.js";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Владелец сети",
  ADMIN: "Управляющий",
  STAFF: "Администратор зала",
};

/** Настройки клуба и сети: доступны управляющему по своему залу, владельцу — по всем. */
export function SettingsScreen({
  club,
  staff,
  clubs,
  onClubsChanged,
}: {
  club: Club;
  staff: Staff;
  clubs: Club[];
  onClubsChanged: () => void;
}) {
  const isOwner = staff.role === "OWNER";
  /** Зоны, машины и товары сервер разрешает править владельцу и управляющему. */
  const canManageHall = staff.role === "OWNER" || staff.role === "ADMIN";
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [people, setPeople] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [nextTenant, nextPeople] = await Promise.all([api.tenant(), api.staff()]);
    setTenant(nextTenant);
    setPeople(nextPeople);
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setError(null);
    setDone(null);
    try {
      await action();
      await load();
      setDone(message);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <main>
      {error && <div className="error">{error}</div>}
      {done && <div className="notice">{done}</div>}

      <ClubSettings club={club} onSaved={(msg) => void run(async () => onClubsChanged(), msg)} />

      {/*
       * Зоны и машины правит владелец или управляющий: сервер закрывает эти
       * запросы ролью. Администратору зала кнопки не показываем вовсе — нажатие,
       * которое всегда возвращает отказ, хуже отсутствующей кнопки.
       * Зоны выше машин: машина заводится в зону, а не наоборот.
       */}
      {canManageHall && (
        <>
          <ZonesSection club={club} onChanged={() => onClubsChanged()} />
          <ComputersSection club={club} />
        </>
      )}

      {isOwner && tenant && (
        <>
          <WalletSettings
            tenant={tenant}
            clubs={clubs}
            onSaved={(msg) => void run(async () => {}, msg)}
          />
          <ClubsSection clubs={clubs} onCreated={() => void run(async () => onClubsChanged(), "Зал добавлен")} />
        </>
      )}

      <StaffSection people={people} clubs={clubs} isOwner={isOwner} onChanged={() => void load()} />
    </main>
  );
}

function ClubSettings({ club, onSaved }: { club: Club; onSaved: (message: string) => void }) {
  const [creditLimit, setCreditLimit] = useState(String(club.creditLimit / 100));
  const [validity, setValidity] = useState(String(club.packageValidityDays));
  const [warn, setWarn] = useState(String(club.lowBalanceWarnMinutes));
  const [bonus, setBonus] = useState(String(club.bonusPercent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Поля берут значения из клуба: иначе «Сохранить» затрёт настройку,
  // которую форма не показала.
  useEffect(() => {
    setCreditLimit(String(club.creditLimit / 100));
    setValidity(String(club.packageValidityDays));
    setWarn(String(club.lowBalanceWarnMinutes));
    setBonus(String(club.bonusPercent));
  }, [club]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateClub(club.id, {
        creditLimit: toTiyn(creditLimit),
        packageValidityDays: Number(validity),
        lowBalanceWarnMinutes: Number(warn),
        bonusPercent: Number(bonus),
      });
      onSaved("Настройки зала сохранены");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Зал «{club.name}»</h2>
      </div>
      {error && <div className="error">{error}</div>}
      <form className="settings-grid" onSubmit={submit}>
        <label>
          Лимит игры в долг, ₸
          <input inputMode="decimal" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
        </label>
        <label>
          Срок жизни пакета, дней
          <input inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value)} />
        </label>
        <label>
          Предупреждать за, минут
          <input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} />
        </label>
        <label>
          Бонусы, % от потраченного
          <input inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Сохранить
        </button>
      </form>
    </section>
  );
}

function WalletSettings({
  tenant,
  clubs,
  onSaved,
}: {
  tenant: Tenant;
  clubs: Club[];
  onSaved: (message: string) => void;
}) {
  const [target, setTarget] = useState(clubs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.updateTenant({
        sharedBalance: next,
        ...(next ? {} : { moveBalancesToClubId: target }),
      });
      onSaved(next ? "Кошельки объединены" : "Остатки перенесены в выбранный зал");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Кошелёк сети</h2>
        <span className={`chip ${tenant.sharedBalance ? "in-use" : "idle"}`}>
          {tenant.sharedBalance ? "общий" : "по клубам"}
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Переключение меняет структуру денег, поэтому объясняем последствия до нажатия. */}
      <div className="notice">
        {tenant.sharedBalance
          ? "Баланс гостя действует во всех залах сети. Пополнение и расход могут оказаться в разных залах — разницу показывает взаимозачёт."
          : "У гостя свой кошелёк в каждом зале. Аккаунт и история общие по сети в любом случае."}
      </div>

      {tenant.sharedBalance ? (
        <>
          <div className="notice warn">
            Разделить общий остаток по залам корректно нельзя — система не знает, чьи это деньги.
            Укажите зал, куда перенести остатки.
          </div>
          <div className="actions">
            <select style={{ width: 260 }} value={target} onChange={(e) => setTarget(e.target.value)}>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="danger" disabled={busy || !target} onClick={() => void toggle(false)}>
              Выключить общий кошелёк
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void toggle(true)}>
            Включить общий кошелёк
          </button>
        </div>
      )}
    </section>
  );
}

function ClubsSection({ clubs, onCreated }: { clubs: Club[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Залы сети</h2>
        <span className="count">{clubs.length}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Зал</th>
              <th>Город</th>
              <th>Лимит долга</th>
              <th>Срок пакета</th>
            </tr>
          </thead>
          <tbody>
            {clubs.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.city ?? "—"}</td>
                <td className="num">{formatMoney(c.creditLimit)}</td>
                <td className="num">{c.packageValidityDays} дн</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions" style={{ marginTop: 10 }}>
        <input
          style={{ width: 220 }}
          placeholder="Название нового зала"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          style={{ width: 160 }}
          placeholder="Город"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <button
          disabled={busy || name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.createClub({ name: name.trim(), city: city.trim() || undefined });
              setName("");
              setCity("");
              onCreated();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Добавить зал
        </button>
      </div>
    </section>
  );
}

function StaffSection({
  people,
  clubs,
  isOwner,
  onChanged,
}: {
  people: StaffMember[];
  clubs: Club[];
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    password: "",
    role: "STAFF",
    clubId: clubs[0]?.id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clubName = (id: string | null): string =>
    id === null ? "вся сеть" : (clubs.find((c) => c.id === id)?.name ?? "—");

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Сотрудники</h2>
        <span className="count">{people.length}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Почта</th>
              <th>Роль</th>
              <th>Зал</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} style={{ opacity: person.isActive ? 1 : 0.5 }}>
                <td>{person.fullName}</td>
                <td className="num">{person.email}</td>
                <td>{ROLE_LABEL[person.role]}</td>
                <td>{clubName(person.clubId)}</td>
                {isOwner && (
                  <td>
                    <button
                      onClick={async () => {
                        setError(null);
                        try {
                          await api.updateStaff(person.id, { isActive: !person.isActive });
                          onChanged();
                        } catch (cause) {
                          setError((cause as Error).message);
                        }
                      }}
                    >
                      {person.isActive ? "Отключить" : "Включить"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isOwner && (
        <div className="actions" style={{ marginTop: 10 }}>
          <input
            style={{ width: 170 }}
            placeholder="Имя"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <input
            style={{ width: 200 }}
            placeholder="Почта"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            style={{ width: 150 }}
            type="password"
            placeholder="Пароль"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select
            style={{ width: 180 }}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="STAFF">Администратор зала</option>
            <option value="ADMIN">Управляющий</option>
            <option value="OWNER">Владелец сети</option>
          </select>
          {/* Владельцу сети зал не назначается: пустой клуб открывает ему все залы. */}
          {form.role !== "OWNER" && (
            <select
              style={{ width: 220 }}
              value={form.clubId}
              onChange={(e) => setForm({ ...form, clubId: e.target.value })}
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="primary"
            disabled={busy || form.email.length < 5 || form.password.length < 6}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.createStaff({
                  email: form.email.trim(),
                  fullName: form.fullName.trim(),
                  password: form.password,
                  role: form.role,
                  ...(form.role === "OWNER" ? {} : { clubId: form.clubId }),
                });
                setForm({ ...form, email: "", fullName: "", password: "" });
                onChanged();
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Добавить сотрудника
          </button>
        </div>
      )}
    </section>
  );
}
