import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Tab } from "./App.js";
import {
  type Club,
  type HallCell,
  type Tariff,
  api,
  formatMoney,
} from "./api.js";
import { SeatPanel } from "./SeatPanel.js";
import { SessionPanel } from "./SessionPanel.js";
import { SeatRequests } from "./SeatRequests.js";
import { StaffCalls } from "./StaffCalls.js";
import { useRealtime } from "./useRealtime.js";

/** Размер плитки карты в px: минимум, максимум, шаг зума и значение по умолчанию. */
const PC_MIN_MIN = 96;
const PC_MIN_MAX = 288;
const PC_MIN_STEP = 24;
const PC_MIN_DEFAULT = 144;

/**
 * Значок на плитке: бронь (замок) или пауза. Декоративный — состояние уже
 * подписано чипом и цветом, значок лишь усиливает.
 */
function StateIcon({ kind }: { kind: "reserved" | "paused" }) {
  return (
    <svg
      className="pc-icon"
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "reserved" ? (
        <>
          <rect x="4" y="11" width="16" height="9" rx="2"></rect>
          <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
        </>
      ) : (
        <>
          <rect x="7" y="5" width="3.5" height="14" rx="1"></rect>
          <rect x="13.5" y="5" width="3.5" height="14" rx="1"></rect>
        </>
      )}
    </svg>
  );
}

/**
 * Состояние плитки: то, что админ должен считывать взглядом, по цвету.
 * Играет — голубой, 100%-скидка — жёлтый, свободен — зелёный, бронь —
 * фиолетовый, ремонт — красный, выключен — серый. В долг не сажаем (лимит 0),
 * поэтому состояния «в долг» нет.
 */
function cellState(cell: HallCell): string {
  const session = cell.session;
  if (session) {
    if (session.status === "PAUSED") return "PAUSED";
    // 100% скидка — гость играет бесплатно: отдельный цвет, чтобы было видно.
    if (session.guest?.discountPercent === 100) return "FREE";
    return "IN_USE";
  }
  switch (cell.computer.status) {
    case "RESERVED":
      return "RESERVED";
    case "MAINTENANCE":
      return "MAINTENANCE";
    case "OFFLINE":
      return "OFFLINE";
    default:
      return "IDLE";
  }
}

const STATE_LABEL: Record<string, string> = {
  IN_USE: "играет",
  FREE: "100% скидка",
  PAUSED: "пауза",
  RESERVED: "бронь",
  MAINTENANCE: "ремонт",
  OFFLINE: "выключен",
  IDLE: "свободен",
};

const STATE_CLASS: Record<string, string> = {
  IN_USE: "playing",
  FREE: "free",
  PAUSED: "paused",
  RESERVED: "reserved",
  MAINTENANCE: "maintenance",
  OFFLINE: "offline",
  IDLE: "idle",
};

export function HallScreen({
  club,
  onGoTo,
}: {
  club: Club;
  onGoTo: (tab: Tab) => void;
}) {
  const [hall, setHall] = useState<HallCell[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Зал загружен хотя бы раз: до этого пустая карта — не пустой клуб. */
  const [loaded, setLoaded] = useState(false);

  /* Масштаб карты: размер плитки в px. Запоминается на этом устройстве. */
  const [pcMin, setPcMin] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("hall-pc-min")) || PC_MIN_DEFAULT;
    } catch {
      return PC_MIN_DEFAULT;
    }
  });
  const zoom = (delta: number): void => {
    setPcMin((current) => {
      const next = Math.min(PC_MIN_MAX, Math.max(PC_MIN_MIN, current + delta));
      try {
        localStorage.setItem("hall-pc-min", String(next));
      } catch {
        // Приватный режим — просто не запомним масштаб.
      }
      return next;
    });
  };

  const refresh = useCallback(async () => {
    setHall(await api.hall(club.id));
    setLoaded(true);
  }, [club.id]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
    void api.tariffs(club.id).then(setTariffs);
  }, [club.id, refresh]);

  /*
   * Вызовы администратора живут отдельно от карты: они не состояние машины, а
   * просьба человека, и снимает их администратор сам, когда подошёл.
   */
  const [calls, setCalls] = useState<Record<string, number>>({});

  // Экран догоняет состояние сам, а не только по событиям: если сокет отвалится,
  // карта зала не должна застыть.
  useRealtime(
    () => void refresh(),
    (computerId) =>
      setCalls((current) => ({ ...current, [computerId]: Date.now() })),
  );
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const zones = useMemo(() => {
    const grouped = new Map<string, { name: string; cells: HallCell[] }>();
    for (const cell of hall) {
      const zone = cell.computer.zone;
      const entry = grouped.get(zone.id) ?? { name: zone.name, cells: [] };
      entry.cells.push(cell);
      grouped.set(zone.id, entry);
    }
    return [...grouped.entries()];
  }, [hall]);

  const summary = useMemo(() => {
    const busy = hall.filter((c) => c.session !== null);
    return {
      busy: busy.length,
      total: hall.length,
      onCredit: busy.filter((c) => c.session?.onCredit).length,
      accrued: busy.reduce((sum, c) => sum + (c.session?.totalCharged ?? 0), 0),
    };
  }, [hall]);

  const selected = hall.find((c) => c.computer.id === selectedId) ?? null;
  const freeComputers = hall.filter(
    (c) => c.session === null && c.computer.id !== selectedId,
  );

  return (
    <main style={{ "--pc-min": `${pcMin}px` } as CSSProperties}>
      <div className="summary">
        <div className="stat">
          <div className="value">
            {summary.busy}/{summary.total}
          </div>
          <div className="label">Занято машин</div>
        </div>
        <div className={`stat ${summary.onCredit > 0 ? "alert" : ""}`}>
          <div className="value">{summary.onCredit}</div>
          <div className="label">Играют в долг</div>
        </div>
        <div className="stat">
          <div className="value">{formatMoney(summary.accrued)}</div>
          <div className="label">Начислено по активным</div>
        </div>
      </div>

      <SeatRequests club={club} />

      <StaffCalls
        calls={Object.entries(calls)
          .map(([computerId, at]) => ({
            computerId,
            at,
            computerName:
              hall.find((c) => c.computer.id === computerId)?.computer.name ??
              "Машина зала",
          }))
          .sort((a, b) => b.at - a.at)}
        onAnswer={(computerId) =>
          setCalls((current) => {
            const next = { ...current };
            delete next[computerId];
            return next;
          })
        }
      />

      {loaded && hall.length === 0 && <FirstSteps onGoTo={onGoTo} />}

      {zones.map(([zoneId, zone]) => (
        <section className="zone-block" key={zoneId}>
          <div className="zone-head">
            <h2>{zone.name}</h2>
            <span className="count">
              {zone.cells.filter((c) => c.session).length}/{zone.cells.length}
            </span>
          </div>

          <div className="hall-grid">
            {zone.cells.map((cell) => {
              const state = cellState(cell);
              return (
                <button
                  key={cell.computer.id}
                  /* Позвавшая машина видна и на карте: администратор смотрит на
                     зал, а не на полосу вызовов. */
                  className={`pc ${calls[cell.computer.id] ? "calling" : ""}`}
                  data-state={state}
                  onClick={() => setSelectedId(cell.computer.id)}
                >
                  <div className="pc-head">
                    <span className="pc-name">
                      {/* Номер ПК виден всегда — и в игре, и выключенным. */}
                      {cell.computer.name}
                      {state === "RESERVED" && <StateIcon kind="reserved" />}
                      {state === "PAUSED" && <StateIcon kind="paused" />}
                    </span>
                    <span className={`chip ${STATE_CLASS[state]}`}>
                      {STATE_LABEL[state]}
                    </span>
                  </div>

                  {cell.session ? (
                    <div className="pc-body">
                      <span className="pc-guest">
                        {cell.session.guest?.fullName ?? "Без аккаунта"}
                      </span>
                      <span className="pc-line">
                        {state === "FREE"
                          ? "бесплатно · 100%"
                          : cell.session.mode === "PACKAGE"
                            ? `осталось ${cell.session.packageMinutesLeft ?? 0} мин`
                            : `хватит на ${cell.session.minutesAffordable ?? 0} мин`}
                      </span>
                      {cell.session.balance !== null && (
                        <span className="pc-line">
                          баланс {formatMoney(cell.session.balance)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="pc-free">
                      {state === "RESERVED"
                        ? "Забронирован"
                        : state === "MAINTENANCE"
                          ? "На ремонте"
                          : state === "OFFLINE"
                            ? "Выключен"
                            : "Свободен"}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {hall.length > 0 && (
        <div className="hall-zoom" role="group" aria-label="Масштаб карты зала">
          <button
            aria-label="Мельче"
            disabled={pcMin <= PC_MIN_MIN}
            onClick={() => zoom(-PC_MIN_STEP)}
          >
            −
          </button>
          <span className="hall-zoom-label">Карта зала</span>
          <button
            aria-label="Крупнее"
            disabled={pcMin >= PC_MIN_MAX}
            onClick={() => zoom(PC_MIN_STEP)}
          >
            +
          </button>
        </div>
      )}

      {selected && (
        <>
          <button
            className="backdrop"
            aria-label="Закрыть"
            onClick={() => setSelectedId(null)}
          />
          <aside className="drawer">
            {selected.session ? (
              <SessionPanel
                club={club}
                cell={selected}
                freeComputers={freeComputers}
                onDone={() => {
                  setSelectedId(null);
                  void refresh();
                }}
              />
            ) : (
              <SeatPanel
                club={club}
                cell={selected}
                tariffs={tariffs}
                onDone={() => {
                  void refresh();
                }}
              />
            )}
            <button onClick={() => setSelectedId(null)}>Закрыть</button>
          </aside>
        </>
      )}
    </main>
  );
}

/**
 * Первые шаги в пустом клубе.
 *
 * Сразу после регистрации карта зала пуста, и владелец не знает, с чего
 * начать: машины заводятся в настройках, коды привязки живут на отдельном
 * экране, тарифы — на третьем. Список исчезает сам, как только появляется
 * первая машина, поэтому убирать его руками не нужно.
 */
function FirstSteps({ onGoTo }: { onGoTo: (tab: Tab) => void }) {
  /*
   * Отметок «сделано» здесь нет намеренно. При регистрации клуб уже получает
   * зону «Основной зал» и поминутный тариф-заготовку, так что галочка по факту
   * их существования сказала бы «готово» про то, чего владелец даже не видел.
   */
  const steps: Array<{
    title: string;
    hint: string;
    tab: Tab;
    action: string;
  }> = [
    {
      title: "Заведите машины зала",
      hint: "Зона «Основной зал» уже создана — переименуйте её или добавьте вторую, например VIP, и заведите машины.",
      tab: "settings",
      action: "В настройки",
    },
    {
      title: "Поставьте свои цены",
      hint: "Поминутный тариф-заготовка уже есть. Исправьте цену и добавьте пакеты — отдельно для каждой зоны.",
      tab: "tariffs",
      action: "К тарифам",
    },
    {
      title: "Поставьте агентов на игровые ПК",
      hint: "Там же напечатаны коды привязки — по одному на машину — и переносятся гости из прежней системы.",
      tab: "onboarding",
      action: "К подключению",
    },
  ];

  return (
    <section className="zone-block first-steps">
      <div className="zone-head">
        <h2>С чего начать</h2>
      </div>

      <div className="notice">
        В клубе пока нет ни одной машины. Три шага ниже — всё, что нужно, чтобы
        посадить первого гостя.
      </div>

      <div className="rows">
        {steps.map((step) => (
          <div className="row step" key={step.title}>
            <span className="k">
              <b>{step.title}</b>
              <span className="note">{step.hint}</span>
            </span>
            <button onClick={() => onGoTo(step.tab)}>{step.action}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
