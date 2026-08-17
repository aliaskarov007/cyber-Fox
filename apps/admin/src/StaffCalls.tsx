/**
 * Вызовы администратора: кто из зала нажал кнопку и когда.
 *
 * Полоса висит вверху карты зала и не прячется сама. Уведомление, исчезающее
 * через несколько секунд, на стойке бесполезно: администратор в этот момент
 * наливает кофе или сидит спиной к монитору.
 */
export function StaffCalls({
  calls,
  onAnswer,
}: {
  /** Имя машины и время вызова, свежие сверху. */
  calls: Array<{ computerId: string; computerName: string; at: number }>;
  onAnswer: (computerId: string) => void;
}) {
  if (calls.length === 0) return null;

  return (
    <div className="calls">
      {calls.map((call) => (
        <div className="call" key={call.computerId}>
          <span className="call-name">{call.computerName}</span>
          <span className="call-time">{clock(call.at)}</span>
          <span className="call-text">зовёт администратора</span>
          <button type="button" onClick={() => onAnswer(call.computerId)}>
            Подошёл
          </button>
        </div>
      ))}
    </div>
  );
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("ru-KZ", { hour: "2-digit", minute: "2-digit" });
}
