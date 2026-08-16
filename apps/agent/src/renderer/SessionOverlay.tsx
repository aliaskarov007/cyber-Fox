import { type AgentClient, type Tick, formatMoney, formatRemaining } from "./agent-client.js";

/**
 * Что видит гость во время игры. Главное число — остаток: минуты пакета либо
 * то, на сколько минут хватит баланса. Долг показывается крупно и отдельно,
 * чтобы блокировка не стала неожиданностью.
 */
export function SessionOverlay({
  client,
  tick,
  warnMinutes,
  offline,
  onStopped,
}: {
  client: AgentClient;
  tick: Tick;
  warnMinutes: number;
  /** Связи с сервером нет: часть действий недоступна. */
  offline: boolean;
  onStopped: () => void;
}) {
  const onPackage = tick.packageMinutesLeft !== null;
  const left = onPackage ? tick.packageMinutesLeft! : (tick.minutesAffordable ?? 0);
  const inDebt = tick.balance < 0;

  const tone = inDebt ? "debt" : left <= warnMinutes ? "warn" : "ok";
  const remaining = formatRemaining(left);

  return (
    <div className="card">
      <div className={`timer ${tone}`}>
        <div className={`big ${remaining.unit === null ? "long" : ""}`}>{remaining.value}</div>
        <div className="cap">
          {remaining.unit ? `${remaining.unit} ` : ""}
          {onPackage ? "в пакете" : "хватит баланса"}
        </div>
      </div>

      {inDebt && (
        <div className="banner debt">
          Баланс исчерпан, вы играете в долг. Осталось {formatMoney(tick.creditLeft ?? 0)} — после
          этого экран заблокируется. Подойдите к администратору, чтобы пополнить счёт.
        </div>
      )}

      {!inDebt && left <= warnMinutes && (
        <div className="banner warn">
          {onPackage
            ? "Минуты пакета заканчиваются. Дальше включится поминутный тариф — игра не прервётся."
            : "Времени осталось мало. Пополните счёт у администратора, чтобы продолжить."}
        </div>
      )}

      <div className="rows">
        <div className="row">
          <span className="k">Баланс</span>
          <span>{formatMoney(tick.balance)}</span>
        </div>
        <div className="row">
          <span className="k">Начислено за сессию</span>
          <span>{formatMoney(tick.accruedCost)}</span>
        </div>
      </div>

      {/* Гость завершает сам — списание останавливается сразу, не дожидаясь стойки.
          Без связи завершить нельзя: сервер не узнает об этом, и время продолжит идти. */}
      <button
        disabled={offline}
        onClick={() => void client.stopSession(tick.sessionId).then(onStopped)}
      >
        {offline ? "Завершение недоступно без связи" : "Завершить сессию"}
      </button>

      <button className="ghost" disabled={offline} onClick={() => void client.callStaff()}>
        Позвать администратора
      </button>
    </div>
  );
}
