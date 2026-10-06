import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type AgentClient,
  type GuestLoginResult,
  formatMoney,
} from "./agent-client.js";
import { NATIONAL_LENGTH, addDigit, formatNational, fullPhone } from "./phone-input.js";
import { encodeQr, qrPath } from "./qr.js";

/**
 * Экран блокировки.
 *
 * Первым делом гость выбирает одно из двух: «У меня есть аккаунт» или «Я здесь
 * впервые». Выбор нужен ради понятности — новичок видит, куда ему, — но ничего
 * не ломает, если сделан неверно: дальше всё равно решает номер. Знакомому
 * номеру нужен PIN, новому — придумать PIN и подтвердить номер через WhatsApp.
 * Десятая цифра номера и четвёртая цифра PIN сами отправляют запрос
 * (docs/guest-access.md, раздел 2).
 *
 * Всё набирается экранной клавиатурой мышью или цифрами на клавиатуре — что
 * гостю ближе.
 */

/** Что выбрал гость на первом экране. */
type Intent = "login" | "register";

type Step =
  | { kind: "choose" }
  | { kind: "phone"; intent: Intent }
  | { kind: "pin" }
  | { kind: "newPin" }
  | {
      kind: "whatsapp";
      verificationId: string;
      link: string;
      code: string;
      businessNumber: string;
      expiresAt: number;
    }
  | { kind: "consent"; guestId: string; text: string; bonus: number; verified: boolean };

/** Как часто экран спрашивает, пришло ли сообщение в WhatsApp. */
const STATUS_POLL_MS = 2000;

export function LockScreen({
  client,
  perMinutePrice,
  consentBonus,
  online,
  onStarted,
}: {
  client: AgentClient;
  perMinutePrice: number | null;
  /** Подарок за подписку — на первом экране как повод зарегистрироваться. */
  consentBonus: number;
  /** Без связи с сервером вход невозможен: проверить PIN и баланс некому. */
  online: boolean;
  onStarted: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<GuestLoginResult | null>(null);

  function restart(message: string | null = null): void {
    setStep({ kind: "choose" });
    setPhone("");
    setPin("");
    setCard(null);
    setError(message);
    setNotice(null);
  }

  const login = useCallback(
    async (enteredPin: string): Promise<void> => {
      const result = await client.login(fullPhone(phone), enteredPin);
      if (!result.ok) {
        setPin("");
        setError(result.reason ?? "Не удалось войти");
        // Без денег карточка всё равно нужна — гость видит, к кому идти.
        if (result.guest) setCard(result);
        return;
      }
      setCard(result);
    },
    [client, phone],
  );

  function choose(intent: Intent): void {
    setError(null);
    setNotice(null);
    setPhone("");
    setPin("");
    setStep({ kind: "phone", intent });
  }

  /**
   * Номер набран полностью — спрашиваем сервер, что дальше.
   *
   * Если гость ошибся кнопкой на первом экране, не возвращаем его назад, а
   * спокойно ведём туда, куда нужно, и говорим об этом одной строкой.
   */
  async function submitPhone(digits: string, intent: Intent): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await client.lookup(fullPhone(digits));
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      if (result.next === "PIN") {
        setNotice(intent === "register" ? "Этот номер уже зарегистрирован — просто введите PIN." : null);
        setStep({ kind: "pin" });
      } else {
        setNotice(
          intent === "login" ? "Этого номера ещё нет в клубе — давайте зарегистрируем, это 30 секунд." : null,
        );
        setStep({ kind: "newPin" });
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(entered: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await login(entered);
    } catch (cause) {
      setPin("");
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPin(entered: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await client.register(fullPhone(phone), entered);
      if (!result.ok) {
        setPin("");
        setError(result.reason);
        return;
      }
      if (result.mode === "WHATSAPP") {
        setStep({
          kind: "whatsapp",
          verificationId: result.verificationId,
          link: result.link,
          code: result.code,
          businessNumber: result.businessNumber,
          expiresAt: new Date(result.expiresAt).getTime(),
        });
      } else {
        // WhatsApp не подключён: аккаунт есть, номер подтвердит администратор.
        setStep({
          kind: "consent",
          guestId: result.guestId,
          text: result.consentText,
          bonus: result.bonus,
          verified: false,
        });
      }
    } catch (cause) {
      setPin("");
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* Ждём сообщение в WhatsApp: сервер узнаёт о нём сам, экран лишь спрашивает. */
  const waitingFor = step.kind === "whatsapp" ? step.verificationId : null;
  useEffect(() => {
    if (!waitingFor) return;
    let stopped = false;
    const timer = setInterval(() => {
      void client
        .registerStatus(waitingFor)
        .then((status) => {
          if (stopped) return;
          if (status.state === "DONE") {
            setStep({
              kind: "consent",
              guestId: status.guestId,
              text: status.consentText,
              bonus: status.bonus,
              verified: true,
            });
          } else if (status.state === "EXPIRED") {
            setPin("");
            setStep({ kind: "newPin" });
            setError("Время на подтверждение вышло. Придумайте PIN ещё раз — появится новый код.");
          }
        })
        // Обрыв связи переждём: следующий опрос спросит снова.
        .catch(() => undefined);
    }, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [client, waitingFor]);

  async function answerConsent(guestId: string, accept: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await client.consent(guestId, accept);
      if (result.ok && result.bonus > 0) {
        setNotice(`На счёт начислено ${formatMoney(result.bonus)}. Спасибо!`);
      } else if (result.ok && accept) {
        setNotice("Подписка оформлена. Подарок придёт на счёт, когда администратор подтвердит номер.");
      }
      // Аккаунт готов — сразу входим тем же PIN, без повторного набора.
      await login(pin);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Цифра с экранной или обычной клавиатуры. */
  const press = useCallback(
    (key: string): void => {
      if (busy) return;
      if (step.kind === "choose") {
        // Начал набирать цифры сразу — значит, знает, что делать: ведём как вход.
        if (/^\d$/.test(key)) {
          setError(null);
          setPin("");
          setNotice(null);
          setPhone(addDigit("", key));
          setStep({ kind: "phone", intent: "login" });
        }
        return;
      }
      if (step.kind === "phone") {
        if (key === "back") setPhone((d) => d.slice(0, -1));
        else {
          const next = addDigit(phone, key);
          setPhone(next);
          if (next.length === NATIONAL_LENGTH && next !== phone) void submitPhone(next, step.intent);
        }
        return;
      }
      if (step.kind === "pin" || step.kind === "newPin") {
        if (key === "back") {
          setPin((p) => p.slice(0, -1));
          return;
        }
        if (!/^\d$/.test(key) || pin.length >= 4) return;
        const next = pin + key;
        setPin(next);
        setError(null);
        if (next.length === 4) void (step.kind === "pin" ? submitPin(next) : submitNewPin(next));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, step, phone, pin],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") press("back");
      else if (event.key === "Escape") restart();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const qr = useMemo(() => {
    if (step.kind !== "whatsapp") return null;
    try {
      return qrPath(encodeQr(step.link));
    } catch {
      return null;
    }
  }, [step]);

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

  if (card?.guest) {
    const minutes = card.packagesInZone[0];
    return (
      <div className="card">
        <h1>Здравствуйте, {card.guest.fullName}</h1>

        {notice && <div className="banner info">{notice}</div>}
        {error && <div className="error">{error}</div>}

        <div className="rows">
          <div className="row">
            <span className="k">Баланс</span>
            <span>{formatMoney(card.guest.balance)}</span>
          </div>
          {minutes && (
            <div className="row">
              <span className="k">Минуты в этой зоне</span>
              <span>{minutes.minutesRemaining} мин</span>
            </div>
          )}
          {card.perMinutePrice !== null && (
            <div className="row">
              <span className="k">Поминутно</span>
              <span>{formatMoney(card.perMinutePrice)}/мин</span>
            </div>
          )}
          {card.minutesAffordable !== null && !minutes && (
            <div className="row">
              <span className="k">Хватит на</span>
              <span>{card.minutesAffordable} мин</span>
            </div>
          )}
        </div>

        {card.packagesElsewhere.length > 0 && (
          <div className="banner info">
            У вас есть минуты в другой зоне — здесь они не действуют:{" "}
            {card.packagesElsewhere
              .map((p) => `${p.zoneName} — ${p.minutesRemaining} мин`)
              .join(", ")}
          </div>
        )}

        {!card.ok ? null : minutes ? (
          <button className="primary" disabled={busy} onClick={() => void start()}>
            Играть на минутах пакета ({minutes.minutesRemaining} мин)
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => void start()}>
            Начать по поминутному тарифу
          </button>
        )}

        <button className="ghost" onClick={() => restart()}>
          Это не я
        </button>
      </div>
    );
  }

  if (step.kind === "consent") {
    return (
      <div className="card">
        <h1>{step.verified ? "Готово, номер подтверждён!" : "Готово, аккаунт создан!"}</h1>
        {error && <div className="error">{error}</div>}
        <div className="consent-offer">
          {step.bonus > 0 && <div className="gift">+{formatMoney(step.bonus)}</div>}
          <div>Хотите получать приглашения на турниры и события клуба?</div>
        </div>
        {/* Гость видит ровно тот текст, который сохранится как его согласие. */}
        <div className="note">{step.text}</div>
        <button className="primary" disabled={busy} onClick={() => void answerConsent(step.guestId, true)}>
          {step.bonus > 0 ? `Да, хочу +${formatMoney(step.bonus)}` : "Да, хочу"}
        </button>
        <button disabled={busy} onClick={() => void answerConsent(step.guestId, false)}>
          Нет, спасибо
        </button>
      </div>
    );
  }

  if (step.kind === "whatsapp") {
    const minutesLeft = Math.max(0, Math.ceil((step.expiresAt - Date.now()) / 60_000));
    return (
      <div className="card">
        <h1>Подтвердите номер в WhatsApp</h1>
        <div className="note">Шаг 3 из 3</div>
        {error && <div className="error">{error}</div>}
        {qr && (
          <svg
            className="qr"
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            shapeRendering="crispEdges"
            role="img"
            aria-label="QR-код для WhatsApp"
          >
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
        )}
        <ol className="steps">
          <li>Наведите камеру телефона на код</li>
          <li>В WhatsApp нажмите «Отправить» — текст уже вписан</li>
        </ol>
        <div className="note">
          Без камеры: напишите в WhatsApp на номер {step.businessNumber} сообщение{" "}
          <b className="code">{step.code}</b>. Писать нужно с номера {formatNational(phone)}. Код
          действует ещё {minutesLeft} мин.
        </div>
        <div className="waiting">Ждём сообщение…</div>
        <button className="ghost" onClick={() => restart()}>
          Другой номер
        </button>
      </div>
    );
  }

  if (step.kind === "choose") {
    const gift = consentBonus > 0 ? `+${formatMoney(consentBonus)}` : null;
    return (
      <div className="choice">
        {error && <div className="error">{error}</div>}
        {!online && (
          <div className="banner warn">
            Нет связи с сервером — самостоятельный вход временно недоступен. Подойдите к
            администратору.
          </div>
        )}
        <button type="button" className="entry" disabled={!online} onClick={() => choose("login")}>
          <span>
            <span className="entry-title">У меня есть аккаунт</span>
            <span className="entry-text">Вход по номеру и PIN — 5 секунд.</span>
          </span>
          <span className="entry-act">Войти</span>
        </button>
        <button type="button" className="entry new" disabled={!online} onClick={() => choose("register")}>
          <span>
            <span className="entry-title">
              Я здесь впервые
              {gift && <span className="entry-gift">{gift}</span>}
            </span>
            <span className="entry-text">Номер, PIN и WhatsApp — 30 секунд.</span>
          </span>
          <span className="entry-act">Зарегистрироваться</span>
        </button>
      </div>
    );
  }

  const pinStep = step.kind === "pin" || step.kind === "newPin";

  return (
    <div className="card">
      <h1>
        {step.kind === "phone" && (step.intent === "login" ? "Вход" : "Регистрация")}
        {step.kind === "pin" && "Введите PIN"}
        {step.kind === "newPin" && "Придумайте PIN из 4 цифр"}
      </h1>

      {notice && <div className="banner info">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {/* Проверить PIN и остаток без сервера нельзя — честно говорим об этом,
          вместо того чтобы принимать ввод и молча отказывать. */}
      {!online && (
        <div className="banner warn">
          Нет связи с сервером — самостоятельный вход временно недоступен. Подойдите к
          администратору.
        </div>
      )}

      {step.kind === "phone" ? (
        <>
          <div className="note">
            {step.intent === "login" ? "Ваш номер телефона" : "Шаг 1 из 3 · ваш номер телефона"}
          </div>
          <div className={`display ${phone.length === 0 ? "empty" : ""}`}>{formatNational(phone)}</div>
        </>
      ) : (
        <>
          <div className="note">
            {step.kind === "newPin" && "Шаг 2 из 3 · "}
            {formatNational(phone)}
            {step.kind === "newPin" && " · этот PIN понадобится для входа"}
          </div>
          {/* Свой новый PIN гость видит цифрами — опечатку видно сразу. */}
          <div className="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < pin.length ? "filled" : ""}>
                {i < pin.length ? (step.kind === "newPin" ? pin[i] : "●") : ""}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="numpad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" disabled={busy || !online} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        {/* Пустой номер — стирать нечего, кнопка ведёт обратно к выбору. */}
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => (pinStep || phone.length === 0 ? restart() : press("back"))}
        >
          {pinStep || phone.length === 0 ? "Назад" : "⌫"}
        </button>
        <button type="button" disabled={busy || !online} onClick={() => press("0")}>
          0
        </button>
        {pinStep ? (
          <button type="button" className="ghost" disabled={busy} onClick={() => press("back")}>
            ⌫
          </button>
        ) : (
          <span />
        )}
      </div>

      {busy && <div className="waiting">Проверяем…</div>}

      {step.kind === "phone" && perMinutePrice !== null && (
        <div className="note">Поминутный тариф этой зоны — {formatMoney(perMinutePrice)}/мин.</div>
      )}

    </div>
  );
}
