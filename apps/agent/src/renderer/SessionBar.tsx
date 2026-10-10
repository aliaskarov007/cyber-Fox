import { useEffect, useState } from "react";

import { type AgentClient, type Tick, formatMoney, formatRemaining } from "./agent-client.js";
import { BarPanel } from "./BarPanel.js";
import { PromoField } from "./PromoField.js";
import { TopUpPanel } from "./TopUpPanel.js";

/**
 * Полоса состояния над полками.
 *
 * Во время игры главное на экране — игры, а не счётчик, поэтому от прежней
 * карточки осталась одна строка. Тревожный вид она принимает только когда
 * времени в самом деле мало: красный таймер всю сессию заставляет гостя играть
 * с ощущением, что его вот-вот выгонят.
 */
export function SessionBar({
  client,
  tick,
  warnMinutes,
  offline,
  note,
  error,
  onStopped,
}: {
  client: AgentClient;
  tick: Tick;
  warnMinutes: number;
  offline: boolean;
  /** Сообщение о переходе между тарифами. */
  note: string | null;
  /** Не удалось запустить игру. */
  error: string | null;
  onStopped: () => void;
}) {
  /*
   * Молчащая кнопка заставляет гостя жать её ещё несколько раз, а на стойке это
   * выглядит как четыре вызова с одной машины.
   */
  const [called, setCalled] = useState(false);
  /* Открытая панель под полосой: одна за раз, чтобы не заслонять полки. */
  const [panel, setPanel] = useState<"promo" | "topup" | "bar" | null>(null);
  const [promoNote, setPromoNote] = useState<string | null>(null);
  /* Клуб разрешил заказ из бара с ПК — узнаём при старте сессии. */
  const [barEnabled, setBarEnabled] = useState(false);
  const hasAccount = Boolean(tick.guestName);

  // Сообщение о зачислении висит недолго: новый баланс уже виден в полосе.
  useEffect(() => {
    if (!promoNote) return;
    const timer = setTimeout(() => setPromoNote(null), 15_000);
    return () => clearTimeout(timer);
  }, [promoNote]);

  useEffect(() => {
    if (!hasAccount) return;
    void client
      .barMenu()
      .then((menu) => setBarEnabled(menu.enabled))
      .catch(() => setBarEnabled(false));
  }, [client, hasAccount, tick.sessionId]);

  // Администратор отнёс или отменил заказ — гость узнаёт об этом у себя.
  useEffect(
    () =>
      client.onBarOrderUpdated((event) =>
        setPromoNote(
          event.status === "DONE"
            ? "Заказ из бара отмечен как выданный. Приятного аппетита!"
            : "Заказ из бара отменён администратором — деньги вернулись на счёт.",
        ),
      ),
    [client],
  );

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

  const onPackage = tick.packageMinutesLeft !== null;
  const left = onPackage ? tick.packageMinutesLeft! : (tick.minutesAffordable ?? 0);
  const inDebt = tick.balance < 0;
  const tone = inDebt ? "debt" : left <= warnMinutes ? "warn" : "ok";
  const remaining = formatRemaining(left);

  return (
    <>
      <div className={`session-bar ${tone}`}>
        <div className="session-left">
          <span className="session-value">{remaining.value}</span>
          <span className="session-unit">
            {remaining.unit ? `${remaining.unit} ` : ""}
            {onPackage ? "в пакете" : "хватит баланса"}
          </span>
        </div>

        {/*
          * Кто сидит и по какому тарифу. У анонимной посадки имени нет — тогда
          * и показывать нечего, кроме денег.
          */}
        {tick.guestName && (
          <div className="session-guest">
            <span className="session-guest-name">{tick.guestName}</span>
            {tick.tariffName && <span className="k"> · {tick.tariffName}</span>}
          </div>
        )}

        <div className="session-money">
          <span className="k">Баланс</span> {formatMoney(tick.balance)}
          {tick.bonusPoints ? (
            <span className="k"> · бонусы {formatMoney(tick.bonusPoints)}</span>
          ) : null}
        </div>

        <div className="session-actions">
          {/* Бар, пополнение и промокод работают со счётом аккаунта — у анонимной
              посадки его нет. */}
          {hasAccount && barEnabled && (
            <button
              className={panel === "bar" ? "primary" : "ghost"}
              disabled={offline}
              onClick={() => setPanel(panel === "bar" ? null : "bar")}
            >
              Бар
            </button>
          )}
          {hasAccount && (
            <button
              className={panel === "topup" ? "primary" : "ghost"}
              disabled={offline}
              onClick={() => setPanel(panel === "topup" ? null : "topup")}
            >
              Пополнить
            </button>
          )}
          {hasAccount && panel !== "promo" && (
            <button className="ghost" disabled={offline} onClick={() => setPanel("promo")}>
              Промокод
            </button>
          )}
          <button
            className="ghost"
            disabled={offline || called}
            onClick={() => {
              setCalled(true);
              void client.callStaff();
            }}
          >
            {called ? "Администратор идёт" : "Позвать администратора"}
          </button>
          {/* Без связи завершить нельзя: сервер не узнает об этом, и время
              продолжит идти. */}
          <button
            className="ghost"
            disabled={offline}
            onClick={() => void client.stopSession(tick.sessionId).then(onStopped)}
          >
            {offline ? "Нет связи" : "Завершить"}
          </button>
        </div>
      </div>

      {panel === "bar" && (
        <div className="promo-panel">
          <BarPanel
            client={client}
            balance={tick.balance}
            offline={offline}
            onOrdered={setPromoNote}
            onClose={() => setPanel(null)}
          />
        </div>
      )}

      {panel === "topup" && (
        <div className="promo-panel">
          <TopUpPanel
            client={client}
            disabled={offline}
            onPaid={(amount) => setPromoNote(`Счёт пополнен на ${formatMoney(amount)}`)}
            onClose={() => setPanel(null)}
          />
        </div>
      )}

      {panel === "promo" && (
        <div className="promo-panel">
          <PromoField
            client={client}
            disabled={offline}
            startOpen
            onClose={() => setPanel(null)}
            onApplied={(result) =>
              setPromoNote(
                result.kind === "BALANCE"
                  ? `Промокод ${result.code}: на счёт зачислено ${formatMoney(result.amount)}`
                  : `Промокод ${result.code}: начислено ${formatMoney(result.amount)} бонусами`,
              )
            }
          />
        </div>
      )}

      {promoNote && <div className="banner info">{promoNote}</div>}

      {inDebt && (
        <div className="banner debt">
          Баланс исчерпан, вы играете в долг. Осталось {formatMoney(tick.creditLeft ?? 0)} — после
          этого экран заблокируется. Подойдите к администратору.
        </div>
      )}

      {!inDebt && left <= warnMinutes && (
        <div className="banner warn">
          {onPackage
            ? "Минуты пакета заканчиваются. Дальше включится поминутный тариф — игра не прервётся."
            : "Времени осталось мало. Пополните счёт у администратора, чтобы продолжить."}
        </div>
      )}

      {offline && (
        <div className="banner warn">
          Нет связи с сервером. Оплаченное время идёт по таймеру этого ПК и будет учтено, когда
          связь вернётся.
        </div>
      )}

      {note && <div className="banner info">{note}</div>}
      {error && <div className="banner debt">{error}</div>}
    </>
  );
}
