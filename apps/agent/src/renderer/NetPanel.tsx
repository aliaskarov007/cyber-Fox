import { useEffect, useState } from "react";

import type { AgentClient, NetChannels } from "./agent-client.js";

/**
 * Выбор интернет-провайдера на время игры.
 *
 * У разных провайдеров разный пинг до разных игровых серверов, поэтому гость
 * сам выбирает, через какой канал играть. Смена провайдера меняет внешний IP:
 * если менять во время игры, текущее соединение с сервером может переподключиться
 * — об этом предупреждаем.
 */
export function NetPanel({
  client,
  disabled,
  playing,
  onChanged,
  onClose,
}: {
  client: AgentClient;
  disabled: boolean;
  /** Идёт сессия: смена канала грозит обрывом текущей игры. */
  playing: boolean;
  onChanged: (name: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<NetChannels | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void client
      .netChannels()
      .then(setData)
      .catch(() => setError("Не удалось загрузить каналы"));
  }, [client]);

  async function pick(id: string, name: string): Promise<void> {
    if (busy || data?.currentId === id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.netSelect(id);
      if (result.ok) {
        setData((prev) => (prev ? { ...prev, currentId: id } : prev));
        onChanged(name);
      } else {
        setError(result.reason ?? "Не удалось переключить");
      }
    } catch {
      setError("Не удалось переключить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="net-panel">
      <div className="net-head">
        <b>Интернет-провайдер</b>
        <button className="ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>

      {error && <div className="banner debt">{error}</div>}

      <div className="net-options">
        {(data?.channels ?? []).map((ch) => (
          <button
            key={ch.id}
            className={data?.currentId === ch.id ? "primary" : "ghost"}
            disabled={disabled || busy}
            onClick={() => void pick(ch.id, ch.name)}
          >
            {ch.name}
            {data?.currentId === ch.id ? " ✓" : ""}
          </button>
        ))}
      </div>

      {playing && data?.allowMidSession && (
        <p className="net-hint">
          Смена провайдера во время игры может ненадолго прервать текущее
          соединение с игровым сервером.
        </p>
      )}
      {playing && data && !data.allowMidSession && (
        <p className="net-hint">
          Провайдера можно выбрать только в начале сессии.
        </p>
      )}
    </div>
  );
}
