import { useEffect, useMemo, useRef, useState } from "react";

import { AgentClient, type PairedInfo, type Tick } from "./agent-client.js";
import { LockScreen } from "./LockScreen.js";
import { SessionOverlay } from "./SessionOverlay.js";

/** За сколько минут до конца предупреждать гостя. Значение клуба придёт с сервера позже. */
const WARN_MINUTES = 10;

export function App() {
  const client = useMemo(() => new AgentClient(), []);
  const [paired, setPaired] = useState<PairedInfo | null>(null);
  const [tick, setTick] = useState<Tick | null>(null);
  const [online, setOnline] = useState(false);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    void client.connect({
      onPaired: setPaired,
      onTick: (next) => {
        setTick(next);
        // Первый тик после старта снимает блокировку: сервер подтвердил оплату.
        if (!started.current) {
          started.current = true;
          void window.cyberfox.unlock();
        }
      },
      onStarted: () => {
        started.current = true;
        void window.cyberfox.unlock();
      },
      onSwitched: (event) => {
        setSwitchNote(
          event.to === "PER_MINUTE"
            ? "Пакет закончился, включён поминутный тариф. Игра продолжается."
            : "Продолжаем на следующем пакете минут.",
        );
        setTimeout(() => setSwitchNote(null), 15_000);
      },
      onLock: () => {
        started.current = false;
        setTick(null);
        void window.cyberfox.lock();
      },
      onConnectionChange: setOnline,
    });
  }, [client]);

  return (
    <div className="screen">
      <div className="pc-id">
        <div className="name">{paired?.computerName ?? "—"}</div>
        <div className="zone">
          {paired ? `${paired.clubName} · ${paired.zoneName}` : "Подключаемся к серверу"}
        </div>
      </div>

      {switchNote && <div className="banner info">{switchNote}</div>}

      {tick ? (
        <SessionOverlay
          client={client}
          tick={tick}
          warnMinutes={WARN_MINUTES}
          onStopped={() => {
            started.current = false;
            setTick(null);
            void window.cyberfox.lock();
          }}
        />
      ) : (
        <LockScreen
          client={client}
          perMinutePrice={null}
          onStarted={() => {
            started.current = true;
            void window.cyberfox.unlock();
          }}
        />
      )}

      {/* Обрыв связи прятать нельзя: гость должен понимать, почему не проходит вход. */}
      <div className={`status ${online ? "" : "offline"}`}>
        {online ? "связь с сервером есть" : "нет связи с сервером — идёт переподключение"}
      </div>
    </div>
  );
}
