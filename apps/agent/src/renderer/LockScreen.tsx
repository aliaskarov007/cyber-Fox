import { type FormEvent, useEffect, useState } from "react";

import {
  type AgentClient,
  type BuyablePackage,
  type GuestLoginResult,
  formatMoney,
  formatRemaining,
} from "./agent-client.js";

/** «осталось 1 ч 30 мин» — компактно, словами. */
function remainingText(minutes: number): string {
  const r = formatRemaining(minutes);
  return r.unit ? `${r.value} ${r.unit}` : r.value;
}

/** «ещё 2 дня» по сроку действия пакета. */
function daysLeftText(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "истекает сегодня";
  const t10 = days % 10;
  const t100 = days % 100;
  let word = "дней";
  if (t10 === 1 && t100 !== 11) word = "день";
  else if (t10 >= 2 && t10 <= 4 && (t100 < 10 || t100 >= 20)) word = "дня";
  return `ещё ${days} ${word}`;
}
import { PromoField } from "./PromoField.js";
import { TopUpPanel } from "./TopUpPanel.js";
import { SignupScreen } from "./SignupScreen.js";
import { useConfirm } from "./Confirm.js";

/**
 * Экран блокировки: вход по телефону и PIN.
 *
 * Пароль на клубной клавиатуре с очередью за спиной — отказ от идеи
 * самообслуживания, поэтому телефон и четыре цифры (docs/guest-access.md).
 */
export function LockScreen({
  client,
  perMinutePrice,
  online,
  onStarted,
}: {
  client: AgentClient;
  perMinutePrice: number | null;
  /** Без связи с сервером вход невозможен: проверить PIN и баланс некому. */
  online: boolean;
  onStarted: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  /* Молчащая кнопка вызова заставляет гостя жать её ещё несколько раз, а на
     стойке это выглядит как несколько вызовов с одной машины. */
  const [called, setCalled] = useState(false);

  /*
   * Кнопка возвращается в исходное через минуту. Таймер снимается при уходе с
   * экрана: сессия заканчивается блокировкой, компонент исчезает, и оставленный
   * таймер дёргал бы состояние уже несуществующего экрана.
   */
  useEffect(() => {
    if (!called) return;
    const timer = setTimeout(() => setCalled(false), 60_000);
    return () => clearTimeout(timer);
  }, [called]);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<GuestLoginResult | null>(null);
  const [signingUp, setSigningUp] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  /* Пакеты, которые гость может купить сам в своей зоне. */
  const [packages, setPackages] = useState<BuyablePackage[]>([]);
  const [useBonus, setUseBonus] = useState(false);
  const confirm = useConfirm();

  /* Деньги пришли — карточка пересчитывается: от баланса зависит, можно ли начать. */
  async function refreshCard(): Promise<void> {
    try {
      const next = await client.guestCard();
      if (next.guest) {
        setCard(next);
        setError(next.ok ? null : (next.reason ?? null));
      }
    } catch {
      // Карточку обновит следующий вход; деньги на счёте уже есть.
    }
    void refreshPackages();
  }

  /* Список покупаемых пакетов и доступность зависят от баланса — обновляем вместе. */
  async function refreshPackages(): Promise<void> {
    try {
      const { packages: list } = await client.packageOptions();
      setPackages(list);
    } catch {
      setPackages([]);
    }
  }

  // Гость опознан — подтягиваем доступные пакеты его зоны.
  useEffect(() => {
    if (!card?.guest) {
      setPackages([]);
      return;
    }
    void refreshPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.guest?.id]);

  async function buyPackage(pkg: BuyablePackage, bonus: number): Promise<void> {
    const fromBalance = pkg.price - bonus;
    const how =
      bonus > 0
        ? `${formatMoney(bonus)} бонусами и ${formatMoney(fromBalance)} с баланса`
        : `${formatMoney(pkg.price)} с баланса`;
    if (!(await confirm(`Купить пакет «${pkg.name}» за ${how}?`))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.buyPackage(pkg.id, bonus);
      if (result.ok && result.card) {
        setCard(result.card);
        void refreshPackages();
      } else {
        setError(result.reason ?? "Не удалось купить пакет");
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function login(withPhone: string, withPin: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await client.login(withPhone, withPin);
      /*
       * Гость опознан, но начать ему нечем — карточку всё равно показываем:
       * на ней можно ввести промокод, а причина отказа видна сверху.
       */
      if (result.guest) setCard(result);
      if (!result.ok) setError(result.reason ?? "Не удалось войти");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await login(phone, pin);
  }

  async function start(tariffId?: string): Promise<void> {
    if (!card?.guest) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.startSession(card.guest.id, tariffId);
      if (result.ok) onStarted();
      else setError(result.reason ?? "Не удалось начать сессию");
    } finally {
      setBusy(false);
    }
  }

  if (signingUp && !card?.guest) {
    return (
      <SignupScreen
        client={client}
        onCancel={() => setSigningUp(false)}
        onDone={(newPhone, newPin) => {
          // Аккаунт готов — входим сразу, не заставляя набирать то же самое.
          setSigningUp(false);
          setPhone(newPhone);
          setPin("");
          void login(newPhone, newPin);
        }}
      />
    );
  }

  if (card?.guest) {
    const hasPackage = card.packagesInZone.length > 0;
    const firstPackage = card.packagesInZone[0];
    const bonusPoints = card.guest.bonusPoints;
    return (
      <div className="card">
        <h1>Здравствуйте, {card.guest.fullName}</h1>

        {error && <div className="error">{error}</div>}

        <div className="rows">
          <div className="row">
            <span className="k">Баланс</span>
            <span>{formatMoney(card.guest.balance)}</span>
          </div>
          {card.guest.discountPercent > 0 && (
            <div className="row">
              <span className="k">Ваша скидка</span>
              <span>{card.guest.discountPercent}%</span>
            </div>
          )}
          {card.guest.bonusPoints > 0 && (
            <div className="row">
              <span className="k">Бонусы</span>
              <span>{formatMoney(card.guest.bonusPoints)}</span>
            </div>
          )}
          {card.perMinutePrice !== null && (
            <div className="row">
              <span className="k">Поминутно</span>
              <span>{formatMoney(card.perMinutePrice)}/мин</span>
            </div>
          )}
          {card.minutesAffordable !== null && !hasPackage && (
            <div className="row">
              <span className="k">Хватит на</span>
              <span>{card.minutesAffordable} мин</span>
            </div>
          )}
        </div>

        {/* Купленные пакеты гостя в этой зоне: остаток и срок действия. */}
        {hasPackage && (
          <div className="packages">
            <div className="packages-title">Мои пакеты</div>
            {card.packagesInZone.map((p) => (
              <div className="package" key={p.id}>
                <span className="package-name">{p.name}</span>
                <span className="package-left">
                  осталось {remainingText(p.minutesRemaining)}
                </span>
                <span className="package-until">
                  действует {daysLeftText(p.expiresAt)}
                </span>
              </div>
            ))}
          </div>
        )}

        {card.packagesElsewhere.length > 0 && (
          <div className="banner info">
            У вас есть пакеты в другой зоне — здесь они не действуют:{" "}
            {card.packagesElsewhere
              .map(
                (p) =>
                  `${p.name} (${p.zoneName}) — осталось ${remainingText(
                    p.minutesRemaining,
                  )}, действует ${daysLeftText(p.expiresAt)}`,
              )
              .join("; ")}
          </div>
        )}

        {firstPackage ? (
          <button
            className="primary"
            disabled={busy || !card.ok}
            onClick={() => void start()}
          >
            Играть на минутах пакета ({firstPackage.minutesRemaining} мин)
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !card.ok}
            onClick={() => void start()}
          >
            Начать по поминутному тарифу
          </button>
        )}

        {packages.length > 0 && (
          <div className="pkg-buy">
            <div className="pkg-buy-title">Купить пакет</div>
            {bonusPoints > 0 && (
              <label className="pkg-bonus">
                <input
                  type="checkbox"
                  checked={useBonus}
                  onChange={(e) => setUseBonus(e.target.checked)}
                />
                Списать бонусы ({formatMoney(bonusPoints)}) — остальное
                с баланса
              </label>
            )}
            {packages.map((p) => {
              const bonus = useBonus ? Math.min(bonusPoints, p.price) : 0;
              return (
                <button
                  key={p.id}
                  className="pkg-option"
                  disabled={busy || !online || !p.affordable}
                  onClick={() => void buyPackage(p, bonus)}
                >
                  <span className="pkg-name">{p.name}</span>
                  <span className="pkg-meta">
                    {p.minutes} мин · {formatMoney(p.price)}
                    {bonus > 0
                      ? ` · бонусами ${formatMoney(bonus)} + с баланса ${formatMoney(p.price - bonus)}`
                      : ""}
                    {!p.affordable ? " · не хватает" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {topUpOpen ? (
          <TopUpPanel
            client={client}
            disabled={!online}
            onPaid={() => void refreshCard()}
            onClose={() => setTopUpOpen(false)}
          />
        ) : (
          <button
            className="ghost"
            type="button"
            disabled={!online}
            onClick={() => setTopUpOpen(true)}
          >
            Пополнить счёт по QR
          </button>
        )}

        <PromoField
          client={client}
          disabled={!online}
          onApplied={(result) => {
            // Баланс поменялся — от него зависит, можно ли начать.
            if (result.card) {
              setCard(result.card);
              setError(result.card.ok ? null : (result.card.reason ?? null));
            }
          }}
        />

        <button
          className="ghost"
          onClick={() => {
            setCard(null);
            setError(null);
            setTopUpOpen(false);
            void client.logout().catch(() => null);
          }}
        >
          Это не я
        </button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Вход в клуб</h1>

      {error && <div className="error">{error}</div>}

      {/* Проверить PIN и остаток без сервера нельзя — честно говорим об этом,
          вместо того чтобы принимать ввод и молча отказывать. */}
      {!online && (
        <div className="banner warn">
          Нет связи с сервером — самостоятельный вход временно недоступен.
          Подойдите к администратору.
        </div>
      )}

      <label>
        Номер телефона
        <input
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+7 700 000 00 00"
          autoFocus
        />
      </label>

      <label>
        PIN
        <input
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="····"
        />
      </label>

      <button
        className="primary"
        type="submit"
        disabled={busy || pin.length !== 4}
      >
        {busy ? "Проверяем…" : "Войти"}
      </button>

      {/* Новый гость регистрируется сам: QR → сообщение в WhatsApp клуба → ник и PIN. */}
      <button
        className="ghost"
        type="button"
        disabled={!online}
        onClick={() => setSigningUp(true)}
      >
        Я здесь впервые — регистрация
      </button>

      {/*
       * Забыл PIN — тот же путь: подтвердив номер в WhatsApp, гость задаёт новый
       * PIN (сервер узнаёт существующий аккаунт и покажет «С возвращением»).
       * Отдельная кнопка нужна, потому что вернувшийся гость не нажмёт
       * «Я здесь впервые».
       */}
      <button
        className="ghost"
        type="button"
        disabled={!online}
        onClick={() => setSigningUp(true)}
      >
        Забыли PIN? Получить новый по WhatsApp
      </button>

      {perMinutePrice !== null && (
        <div className="note">
          Поминутный тариф этой зоны — {formatMoney(perMinutePrice)}/мин.
        </div>
      )}

      <button
        className="ghost"
        type="button"
        disabled={called}
        onClick={() => {
          setCalled(true);
          void client.callStaff();
        }}
      >
        {called ? "Администратор идёт" : "Позвать администратора"}
      </button>
    </form>
  );
}
