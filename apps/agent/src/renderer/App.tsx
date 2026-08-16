import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentSettings } from "../shared/settings.js";
import { AgentClient, type AgentConfig, type PairedInfo, type Tick } from "./agent-client.js";
import { LockScreen } from "./LockScreen.js";
import { SessionOverlay } from "./SessionOverlay.js";
import { SetupScreen } from "./SetupScreen.js";
import {
  type JournalState,
  acknowledge,
  applyServerTick,
  emptyJournal,
  minutesLeft,
  sealOfflineMinutes,
  tickOffline,
} from "./offline-journal.js";

/** За сколько минут до конца предупреждать гостя. Значение клуба придёт с сервера позже. */
const WARN_MINUTES = 10;

/** Монотонные часы: перевод системного времени не должен дарить бесплатные часы. */
const monotonic = (): number => performance.now();

export function App() {
  const client = useMemo(() => new AgentClient(), []);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  /** Сервер отказал в привязке: показываем настройку с причиной. */
  const [rejection, setRejection] = useState<string | null>(null);
  const [paired, setPaired] = useState<PairedInfo | null>(null);
  const [tick, setTick] = useState<Tick | null>(null);
  const [online, setOnline] = useState(false);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  /** Локальный остаток на время обрыва: показываем его вместо серверного. */
  const [localMinutes, setLocalMinutes] = useState<number | null>(null);
  const started = useRef(false);
  const journal = useRef<JournalState>(emptyJournal());

  /** Досылка накопленного. Очередь чистится только по подтверждению сервера. */
  const flush = useCallback(async () => {
    journal.current = sealOfflineMinutes(journal.current, new Date().toISOString(), () =>
      crypto.randomUUID(),
    );
    const pending = journal.current.queue;
    setQueued(pending.length);
    if (pending.length === 0) return;

    const result = await client.replayOffline(pending).catch(() => null);
    if (result?.ok) {
      journal.current = acknowledge(
        journal.current,
        pending.map((op) => op.uuid),
      );
      setQueued(journal.current.queue.length);
    }
  }, [client]);

  useEffect(() => {
    void window.cyberfox.config().then(setConfig);
  }, []);

  useEffect(() => {
    // Ненастроенная машина никуда не подключается: без кода привязки сервер
    // всё равно не знает, что это за ПК.
    if (!config?.configured) return;

    void client.connect({
      onPaired: (info) => {
        setRejection(null);
        setPaired(info);
      },
      onRejected: setRejection,
      onTick: (next) => {
        setTick(next);
        setLocalMinutes(null);
        journal.current = applyServerTick(
          journal.current,
          {
            sessionId: next.sessionId,
            packageMinutesLeft: next.packageMinutesLeft,
            minutesAffordable: next.minutesAffordable,
            balance: next.balance,
            accruedCost: next.accruedCost,
          },
          monotonic(),
          new Date().toISOString(),
        );
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
        setLocalMinutes(null);
        journal.current = emptyJournal();
        void window.cyberfox.lock();
      },
      onConnectionChange: (isOnline) => {
        setOnline(isOnline);
        // Связь вернулась — первым делом досылаем отыгранное офлайн.
        if (isOnline) void flush();
      },
    });
  }, [client, flush, config]);

  /*
   * Локальный таймер на время обрыва. Оплаченная сессия доигрывается без
   * облака, минуты копятся в журнале и уходят на сервер после восстановления
   * связи (docs/offline.md, уровень 2).
   */
  useEffect(() => {
    if (online || !tick) return;

    const timer = setInterval(() => {
      const result = tickOffline(journal.current, monotonic());
      journal.current = result.state;
      setLocalMinutes(minutesLeft(result.state));

      if (result.exhausted) {
        // Оплаченное кончилось, а спросить сервер нельзя: блокируем экран и
        // сообщим об этом при восстановлении связи.
        started.current = false;
        void window.cyberfox.lock();
      }
    }, 5_000);

    return () => clearInterval(timer);
  }, [online, tick]);

  const displayTick: Tick | null =
    tick && localMinutes !== null
      ? {
          ...tick,
          // Без связи показываем локальный остаток: серверные числа устарели.
          packageMinutesLeft: tick.packageMinutesLeft === null ? null : localMinutes,
          minutesAffordable: tick.packageMinutesLeft === null ? localMinutes : tick.minutesAffordable,
        }
      : tick;

  if (!config) return <div className="screen" />;

  /*
   * Настройка показывается и при первом запуске, и когда сервер отказал в
   * привязке: в обоих случаях админу нужно то же самое поле для кода. Гость
   * этот экран не увидит — машина настраивается до того, как её отдают в зал.
   */
  if (!config.configured || rejection) {
    const save = (settings: AgentSettings): void => {
      // Окно перезагрузит основной процесс — состояние здесь чинить не нужно.
      void window.cyberfox.saveConfig(settings);
    };
    return (
      <SetupScreen
        initial={{ serverUrl: config.serverUrl, pairingToken: config.pairingToken }}
        hostname={config.hostname}
        error={rejection}
        onSave={save}
      />
    );
  }

  return (
    <div className="screen">
      <div className="pc-id">
        <div className="name">{paired?.computerName ?? "—"}</div>
        <div className="zone">
          {paired ? `${paired.clubName} · ${paired.zoneName}` : "Подключаемся к серверу"}
        </div>
      </div>

      {switchNote && <div className="banner info">{switchNote}</div>}

      {!online && displayTick && (
        <div className="banner warn">
          Нет связи с сервером. Оплаченное время идёт по таймеру этого ПК и будет учтено, когда
          связь вернётся.
        </div>
      )}

      {displayTick ? (
        <SessionOverlay
          client={client}
          tick={displayTick}
          warnMinutes={WARN_MINUTES}
          offline={!online}
          onStopped={() => {
            started.current = false;
            setTick(null);
            setLocalMinutes(null);
            void window.cyberfox.lock();
          }}
        />
      ) : (
        <LockScreen
          client={client}
          perMinutePrice={null}
          online={online}
          onStarted={() => {
            started.current = true;
            void window.cyberfox.unlock();
          }}
        />
      )}

      {/* Обрыв связи прятать нельзя: гость должен понимать, почему не проходит вход. */}
      <div className={`status ${online ? "" : "offline"}`}>
        {online
          ? "связь с сервером есть"
          : `нет связи с сервером${queued > 0 ? ` · в очереди операций: ${queued}` : ""}`}
      </div>
    </div>
  );
}
