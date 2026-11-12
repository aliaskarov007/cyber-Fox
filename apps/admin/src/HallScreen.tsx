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
  type MapObject,
  type Staff,
  type Tariff,
  type Zone,
  api,
  formatMoney,
} from "./api.js";
import { SeatPanel } from "./SeatPanel.js";
import { SessionPanel } from "./SessionPanel.js";
import { SeatRequests } from "./SeatRequests.js";
import { StaffCalls } from "./StaffCalls.js";
import { useRealtime } from "./useRealtime.js";

/** Размер клетки плана в px: минимум, максимум, шаг зума и значение по умолчанию. */
const PC_MIN_MIN = 52;
const PC_MIN_MAX = 120;
const PC_MIN_STEP = 10;
const PC_MIN_DEFAULT = 74;

/** Цвета залов на карте: по порядку зон, по кругу. */
const ZONE_COLORS = [
  "#6b9be8",
  "#b07be0",
  "#45c0a0",
  "#e0a24b",
  "#e06b8f",
  "#5bc6c0",
  "#9a8cf0",
  "#c98f5a",
];

/** Остаток времени у сидящего гостя: пакет — его минуты, поминутно — на сколько хватит. */
function remainingMinutes(cell: HallCell): number {
  const session = cell.session;
  if (!session) return 0;
  return (
    (session.mode === "PACKAGE"
      ? session.packageMinutesLeft
      : session.minutesAffordable) ?? 0
  );
}

/** Ч:ММ для таймера на квадрате. */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Короткая подпись в квадрате: только номер. Из «ПК-18», «PC-03», «РС-7»
 * остаётся «18», «03», «7». Если в имени нет цифры — показываем имя как есть.
 */
function pcLabel(name: string): string {
  const match = name.match(/(\d+)\s*$/);
  return match ? match[1] : name;
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

/** Подсказка при наведении: весь контекст ПК без клика. Полное имя — здесь. */
function tileTitle(cell: HallCell, state: string): string {
  const parts = [cell.computer.name, STATE_LABEL[state]];
  const session = cell.session;
  if (session) {
    parts.push(session.guest?.fullName ?? "Без аккаунта");
    if (state !== "FREE") parts.push(`${remainingMinutes(cell)} мин`);
    if (session.balance !== null)
      parts.push(`баланс ${formatMoney(session.balance)}`);
  }
  return parts.join(" · ");
}

/** Значок на плитке: бронь (замок) или пауза. */
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
 * Состояние плитки: то, что админ считывает взглядом, по цвету рамки.
 * Играет — голубой, 100%-скидка — жёлтый, свободен — зелёный, бронь —
 * фиолетовый, ремонт — красный, выключен — серый. В долг не сажаем (лимит 0).
 */
function cellState(cell: HallCell): string {
  const session = cell.session;
  if (session) {
    if (session.status === "PAUSED") return "PAUSED";
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

export function HallScreen({
  club,
  staff,
  onGoTo,
}: {
  club: Club;
  staff: Staff;
  onGoTo: (tab: Tab) => void;
}) {
  const [hall, setHall] = useState<HallCell[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [zoneList, setZoneList] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Правка плана — только владельцу и управляющему.
  const canArrange = staff.role === "OWNER" || staff.role === "ADMIN";
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<{ kind: "pc" | "obj"; id: string } | null>(
    null,
  );
  const [newZone, setNewZone] = useState("");
  const [arrError, setArrError] = useState<string | null>(null);

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
    const [nextHall, nextObjects, nextZones] = await Promise.all([
      api.hall(club.id),
      api.mapObjects(club.id),
      api.zones(club.id),
    ]);
    setHall(nextHall);
    setObjects(nextObjects);
    setZoneList(nextZones);
    setLoaded(true);
  }, [club.id]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
    void api.tariffs(club.id).then(setTariffs);
  }, [club.id, refresh]);

  const [calls, setCalls] = useState<Record<string, number>>({});
  useRealtime(
    () => void refresh(),
    (computerId) =>
      setCalls((current) => ({ ...current, [computerId]: Date.now() })),
  );
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const zoneColor = useCallback(
    (zoneId: string): string => {
      const i = zoneList.findIndex((z) => z.id === zoneId);
      return ZONE_COLORS[(i < 0 ? 0 : i) % ZONE_COLORS.length];
    },
    [zoneList],
  );

  const summary = useMemo(() => {
    const busy = hall.filter((c) => c.session !== null);
    return {
      busy: busy.length,
      total: hall.length,
      accrued: busy.reduce((sum, c) => sum + (c.session?.totalCharged ?? 0), 0),
    };
  }, [hall]);

  const selected = hall.find((c) => c.computer.id === selectedId) ?? null;
  const freeComputers = hall.filter(
    (c) => c.session === null && c.computer.id !== selectedId,
  );

  // --- Правка: залы, объекты карты ---

  async function changeZone(pcId: string, zoneId: string): Promise<void> {
    setArrError(null);
    try {
      await api.updateComputer(club.id, pcId, { zoneId });
    } catch (error) {
      setArrError((error as Error).message);
    }
    await refresh();
  }

  async function addComputer(zoneId: string): Promise<void> {
    const nums = hall.map((c) => {
      const m = c.computer.name.match(/(\d+)\s*$/);
      return m ? Number(m[1]) : 0;
    });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    const name = window.prompt(
      "Название нового ПК",
      `ПК-${String(next).padStart(2, "0")}`,
    );
    if (!name || !name.trim()) return;
    setArrError(null);
    try {
      await api.createComputer(club.id, { name: name.trim(), zoneId });
      await refresh();
    } catch (error) {
      setArrError((error as Error).message);
    }
  }

  async function deletePC(id: string): Promise<void> {
    const pc = hall.find((c) => c.computer.id === id);
    if (!pc) return;
    if (!window.confirm(`Удалить ${pc.computer.name} из клуба?`)) return;
    setArrError(null);
    try {
      await api.deleteComputer(club.id, id);
      setSel(null);
    } catch (error) {
      setArrError((error as Error).message);
    }
    await refresh();
  }

  async function addZone(): Promise<void> {
    const name = newZone.trim();
    if (!name) return;
    setArrError(null);
    try {
      await api.createZone(club.id, { name, sortOrder: zoneList.length });
      setNewZone("");
      await refresh();
    } catch (error) {
      setArrError((error as Error).message);
    }
  }

  async function renameZone(zoneId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    const existing = zoneList.find((z) => z.id === zoneId)?.name;
    if (!trimmed || trimmed === existing) return;
    setArrError(null);
    try {
      await api.updateZone(club.id, zoneId, { name: trimmed });
      await refresh();
    } catch (error) {
      setArrError((error as Error).message);
    }
  }

  /**
   * Добавить элемент обстановки. Готовые подписи (Reception, Lounge, WC,
   * Entrance) приходят сразу с текстом; пустой text у LABEL — спросим название.
   * Показываются отдельной строкой «Обстановка» под залами.
   */
  async function addObject(
    kind: "LABEL" | "WALL",
    presetText?: string,
  ): Promise<void> {
    let text: string | undefined = presetText;
    if (kind === "LABEL" && presetText === undefined) {
      const entered = window.prompt("Название места", "Ресепшн");
      if (entered === null) return;
      text = entered.trim() || "Ресепшн";
    }
    setArrError(null);
    try {
      const created = await api.createMapObject(club.id, {
        kind,
        text,
        posX: 0,
        posY: 0,
        width: kind === "WALL" ? 1 : 3,
        height: kind === "WALL" ? 4 : 2,
      });
      await refresh();
      setSel({ kind: "obj", id: created.id });
    } catch (error) {
      setArrError((error as Error).message);
    }
  }

  async function renameObj(id: string, text: string): Promise<void> {
    setArrError(null);
    try {
      await api.updateMapObject(club.id, id, { text });
    } catch (error) {
      setArrError((error as Error).message);
    }
    await refresh();
  }

  async function deleteObj(id: string): Promise<void> {
    setArrError(null);
    try {
      await api.deleteMapObject(club.id, id);
      setSel(null);
    } catch (error) {
      setArrError((error as Error).message);
    }
    await refresh();
  }

  const selObj =
    sel?.kind === "obj" ? (objects.find((o) => o.id === sel.id) ?? null) : null;
  const selPc =
    sel?.kind === "pc"
      ? (hall.find((c) => c.computer.id === sel.id) ?? null)
      : null;

  return (
    <main style={{ "--pc-min": `${pcMin}px` } as CSSProperties}>
      <div className="summary">
        <div className="stat">
          <div className="value">
            {summary.busy}/{summary.total}
          </div>
          <div className="label">Занято ПК</div>
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

      {loaded && hall.length === 0 && objects.length === 0 && (
        <FirstSteps onGoTo={onGoTo} />
      )}

      {/* Правка плана — только владельцу и управляющему. */}
      {canArrange && (hall.length > 0 || objects.length > 0) && (
        <div className="hall-arrange">
          <button
            className={edit ? "primary" : ""}
            onClick={() => {
              setEdit((v) => !v);
              setSel(null);
              setArrError(null);
            }}
          >
            {edit ? "Готово" : "Изменить план"}
          </button>
          {edit && (
            <>
              {/* Готовые подписи по‑английски — ставятся одним кликом. */}
              {["Reception", "Lounge", "WC", "Entrance"].map((t) => (
                <button key={t} onClick={() => void addObject("LABEL", t)}>
                  + {t}
                </button>
              ))}
              <button onClick={() => void addObject("LABEL")}>
                + Подпись…
              </button>
              <button onClick={() => void addObject("WALL")}>
                + Перегородка
              </button>
              <span className="hall-arrange-hint">
                Чтобы раскидать ПК по залам: нажмите на ПК → в панели выберите
                «Зал» — компьютер перейдёт в эту группу (тариф зала применится
                сам). Там же — удаление ПК. «+ ПК» добавляет машину в зал, «+
                Зал» — новый зал.
              </span>
            </>
          )}
        </div>
      )}
      {edit && arrError && <div className="error">{arrError}</div>}

      {/* Панель выбранного ПК: в какой зал относится и удаление. */}
      {edit && selPc && (
        <div className="map-sel">
          <b>{selPc.computer.name}</b>
          <label>
            Зал
            <select
              value={selPc.computer.zone.id}
              onChange={(e) =>
                void changeZone(selPc.computer.id, e.target.value)
              }
            >
              {zoneList.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="danger"
            onClick={() => void deletePC(selPc.computer.id)}
          >
            Удалить ПК
          </button>
          <button onClick={() => setSel(null)}>Закрыть</button>
        </div>
      )}
      {edit && selObj && (
        <div className="map-sel" key={selObj.id}>
          {selObj.kind === "LABEL" ? (
            <input
              className="zone-rename"
              defaultValue={selObj.text ?? ""}
              placeholder="Название (ресепшн, уборная, диваны…)"
              onBlur={(e) => void renameObj(selObj.id, e.target.value)}
            />
          ) : (
            <b>Перегородка</b>
          )}
          <button className="danger" onClick={() => void deleteObj(selObj.id)}>
            Удалить
          </button>
          <button onClick={() => setSel(null)}>Закрыть</button>
        </div>
      )}

      {/* Залы — отдельными группами. Чтобы раскидать ПК по залам: нажми на ПК
         → выбери «Зал» — компьютер сразу перейдёт в эту группу. */}
      {(hall.length > 0 || edit) && (
        <div className="hall-areas">
          {zoneList.map((zone) => {
            const pcs = hall
              .filter((c) => c.computer.zone.id === zone.id)
              .sort((a, b) =>
                a.computer.name.localeCompare(b.computer.name, "ru", {
                  numeric: true,
                }),
              );
            return (
              <section className="zone-area" key={zone.id}>
                <div className="zone-head">
                  <span
                    className="zone-dot"
                    style={{ background: zoneColor(zone.id) }}
                  />
                  {edit ? (
                    <input
                      className="zone-rename"
                      defaultValue={zone.name}
                      key={zone.name}
                      aria-label="Название зала"
                      onBlur={(e) => void renameZone(zone.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  ) : (
                    <h2>{zone.name}</h2>
                  )}
                  <span className="count">
                    {pcs.filter((c) => c.session).length}/{pcs.length}
                  </span>
                  {edit && (
                    <button
                      className="zone-add-pc"
                      onClick={() => void addComputer(zone.id)}
                    >
                      + ПК
                    </button>
                  )}
                </div>
                <div className="zone-grid">
                  {pcs.map((cell) => {
                    const state = cellState(cell);
                    const guestName = cell.session?.guest?.fullName ?? null;
                    return (
                      <button
                        key={cell.computer.id}
                        className={`pc ${
                          calls[cell.computer.id] ? "calling" : ""
                        } ${edit ? "editing" : ""} ${
                          sel?.id === cell.computer.id ? "sel" : ""
                        }`}
                        data-state={state}
                        title={tileTitle(cell, state)}
                        onClick={() =>
                          edit
                            ? setSel({ kind: "pc", id: cell.computer.id })
                            : setSelectedId(cell.computer.id)
                        }
                      >
                        <span className="pc-num">
                          {pcLabel(cell.computer.name)}
                        </span>
                        {guestName && (
                          <span className="pc-name">{guestName}</span>
                        )}
                        {cell.session ? (
                          <span className="pc-timer">
                            {state === "FREE"
                              ? "∞"
                              : clock(remainingMinutes(cell))}
                          </span>
                        ) : state === "RESERVED" ? (
                          <StateIcon kind="reserved" />
                        ) : state === "PAUSED" ? (
                          <StateIcon kind="paused" />
                        ) : null}
                      </button>
                    );
                  })}
                  {edit && pcs.length === 0 && (
                    <span className="hall-empty-zone">
                      Пусто. «+ ПК» или перенеси ПК из другого зала: нажми ПК →
                      «Зал».
                    </span>
                  )}
                </div>
              </section>
            );
          })}
          {edit && (
            <section className="zone-area add-zone">
              <input
                value={newZone}
                placeholder="Новый зал"
                onChange={(e) => setNewZone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addZone();
                }}
              />
              <button
                disabled={newZone.trim() === ""}
                onClick={() => void addZone()}
              >
                + Зал
              </button>
            </section>
          )}
        </div>
      )}

      {/* Обстановка клуба: ресепшн, WC, диваны, вход, перегородки. */}
      {(objects.length > 0 || edit) && (
        <div className="decor-row">
          <span className="decor-title">Обстановка:</span>
          {objects.map((o) => (
            <button
              key={o.id}
              className={`decor-chip ${sel?.id === o.id ? "sel" : ""}`}
              onClick={
                edit ? () => setSel({ kind: "obj", id: o.id }) : undefined
              }
            >
              {o.text || "Перегородка"}
            </button>
          ))}
          {edit && objects.length === 0 && (
            <span className="decor-empty">
              Добавьте «+ Reception», «+ WC», «+ Lounge», «+ Entrance» или «+
              Перегородка».
            </span>
          )}
        </div>
      )}

      {hall.length > 0 && (
        <div
          className="hall-zoom"
          role="group"
          aria-label="Масштаб карты клуба"
        >
          <button
            aria-label="Мельче"
            disabled={pcMin <= PC_MIN_MIN}
            onClick={() => zoom(-PC_MIN_STEP)}
          >
            −
          </button>
          <span className="hall-zoom-label">Масштаб</span>
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
 * Первые шаги в пустом клубе. Список исчезает сам, как только появляется первая
 * машина, поэтому убирать его руками не нужно.
 */
function FirstSteps({ onGoTo }: { onGoTo: (tab: Tab) => void }) {
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
