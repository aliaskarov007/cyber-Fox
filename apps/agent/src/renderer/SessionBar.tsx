import { useState } from "react";

import { type AgentClient, type Tick, formatMoney, formatRemaining } from "./agent-client.js";

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

        <div className="session-money">
          <span className="k">Баланс</span> {formatMoney(tick.balance)}
        </div>

        <div className="session-actions">
          <button
            className="ghost"
            disabled={offline || called}
            onClick={() => {
              setCalled(true);
              void client.callStaff();
              setTimeout(() => setCalled(false), 60_000);
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
