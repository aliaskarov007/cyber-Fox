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

/** Размер квадрата карты в px: минимум, максимум, шаг зума и значение по умолчанию. */
const PC_MIN_MIN = 44;
const PC_MIN_MAX = 108;
const PC_MIN_STEP = 10;
const PC_MIN_DEFAULT = 62;

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

/** Ч:ММ для таймера на квадрате, как в клубных картах. */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Короткая подпись в кружке: только номер. Из «ПК-18», «PC-03», «РС-7»
 * остаётся «18», «03», «7». Если в имени нет цифры (например «Стрим») —
 * показываем имя как есть.
 */
function pcLabel(name: string): string {
  const match = name.match(/(\d+)\s*$/);
  return match ? match[1] : name;
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Менять расположение и залы может только владелец или управляющий.
  const canArrange = staff.role === "OWNER" || staff.role === "ADMIN";
  const [edit, setEdit] = useState(false);
  const [zoneList, setZoneList] = useState<Zone[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [newZone, setNewZone] = useState("");
  const [arrError, setArrError] = useState<string | null>(null);

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

  // Полный список залов (включая пустые) нужен только для правки расположения.
  const loadZones = useCallback(async () => {
    try {
      setZoneList(await api.zones(club.id));
    } catch {
      // Не загрузились залы — правка просто покажет те, где уже есть машины.
    }
  }, [club.id]);
  useEffect(() => {
    if (edit) void loadZones();
  }, [edit, loadZones]);

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

  const orderedZones = useMemo(() => {
    // Ячейки по залам; внутри — по заданному порядку (posX), нерасставленные в конец.
    const byZone = new Map<string, HallCell[]>();
    for (const cell of hall) {
      const arr = byZone.get(cell.computer.zone.id) ?? [];
      arr.push(cell);
      byZone.set(cell.computer.zone.id, arr);
    }
    const sortCells = (cells: HallCell[]): HallCell[] =>
      [...cells].sort((a, b) => {
        const ax = a.computer.posX;
        const bx = b.computer.posX;
        if (ax === null && bx === null)
          return a.computer.name.localeCompare(b.computer.name, "ru", {
            numeric: true,
          });
        if (ax === null) return 1;
        if (bx === null) return -1;
        return ax - bx;
      });

    // В правке показываем все залы (в т.ч. пустые) по порядку; иначе — только с машинами.
    const meta =
      edit && zoneList.length > 0
        ? zoneList.map((z) => ({ id: z.id, name: z.name }))
        : [...byZone.keys()].map((id) => ({
            id,
            name: byZone.get(id)![0].computer.zone.name,
          }));

    return meta.map((z) => ({
      id: z.id,
      name: z.name,
      cells: sortCells(byZone.get(z.id) ?? []),
    }));
  }, [hall, edit, zoneList]);

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

  /**
   * Перенести машину в зал targetZoneId на место перед beforeId (или в конец,
   * если beforeId пуст). Пересчитываем порядок (posX) в затронутых залах и
   * шлём на сервер только реально изменившиеся машины. Сервер разрешает это
   * лишь владельцу и управляющему — у кассира правка недоступна и в интерфейсе.
   */
  async function move(
    computerId: string,
    targetZoneId: string,
    beforeId: string | null,
  ): Promise<void> {
    const target = orderedZones.find((z) => z.id === targetZoneId);
    const source = orderedZones.find((z) =>
      z.cells.some((c) => c.computer.id === computerId),
    );
    if (!target || !source) return;

    const targetIds = target.cells
      .map((c) => c.computer.id)
      .filter((id) => id !== computerId);
    let idx = beforeId ? targetIds.indexOf(beforeId) : targetIds.length;
    if (idx < 0) idx = targetIds.length;
    targetIds.splice(idx, 0, computerId);

    // Текущее положение каждой машины — чтобы не слать лишних запросов.
    const current = new Map(
      hall.map((c) => [
        c.computer.id,
        { zoneId: c.computer.zone.id, posX: c.computer.posX },
      ]),
    );
    const updates: Array<{ id: string; zoneId: string; posX: number }> = [];
    const consider = (id: string, zoneId: string, posX: number): void => {
      const now = current.get(id);
      if (!now || now.zoneId !== zoneId || now.posX !== posX)
        updates.push({ id, zoneId, posX });
    };
    targetIds.forEach((id, i) => consider(id, targetZoneId, i));
    if (source.id !== targetZoneId) {
      source.cells
        .map((c) => c.computer.id)
        .filter((id) => id !== computerId)
        .forEach((id, i) => consider(id, source.id, i));
    }
    if (updates.length === 0) return;

    setArrError(null);
    try {
      await Promise.all(
        updates.map((u) =>
          api.updateComputer(club.id, u.id, {
            zoneId: u.zoneId,
            posX: u.posX,
            posY: 0,
          }),
        ),
      );
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
      await loadZones();
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
      await loadZones();
      await refresh();
    } catch (error) {
      setArrError((error as Error).message);
    }
  }

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

      {/* Правка расположения — только владельцу и управляющему. */}
      {canArrange && hall.length > 0 && (
        <div className="hall-arrange">
          <button
            className={edit ? "primary" : ""}
            onClick={() => {
              setEdit((v) => !v);
              setArrError(null);
            }}
          >
            {edit ? "Готово" : "Изменить расположение"}
          </button>
          {edit && (
            <>
              <span className="hall-arrange-hint">
                Перетащите ПК, чтобы изменить порядок или перенести в другой
                зал.
              </span>
              <span className="hall-arrange-add">
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
              </span>
            </>
          )}
        </div>
      )}
      {edit && arrError && <div className="error">{arrError}</div>}

      {orderedZones.map((zone) => (
        <section className="zone-block" key={zone.id}>
          <div className="zone-head">
            {edit ? (
              <input
                className="zone-rename"
                defaultValue={zone.name}
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
              {zone.cells.filter((c) => c.session).length}/{zone.cells.length}
            </span>
          </div>

          <div
            className="hall-grid"
            onDragOver={edit ? (e) => e.preventDefault() : undefined}
            onDrop={
              edit
                ? (e) => {
                    // Сброс на пустое место зала — в конец этого зала.
                    e.preventDefault();
                    if (dragId) void move(dragId, zone.id, null);
                    setDragId(null);
                  }
                : undefined
            }
          >
            {zone.cells.length === 0 && edit && (
              <span className="hall-empty-zone">Перетащите сюда ПК</span>
            )}
            {zone.cells.map((cell) => {
              const state = cellState(cell);
              // Имя под кружком у играющих: первое слово, чтобы влезло в колонку.
              const guestName = cell.session?.guest?.fullName ?? null;
              return (
                <div className="pc-cell" key={cell.computer.id}>
                  <button
                    /* Позвавшая машина видна и на карте: администратор смотрит
                       на зал, а не на полосу вызовов. */
                    className={`pc ${calls[cell.computer.id] ? "calling" : ""} ${
                      edit ? "editing" : ""
                    }`}
                    data-state={state}
                    title={tileTitle(cell, state)}
                    draggable={edit}
                    onDragStart={
                      edit ? () => setDragId(cell.computer.id) : undefined
                    }
                    onDragOver={edit ? (e) => e.preventDefault() : undefined}
                    onDrop={
                      edit
                        ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragId && dragId !== cell.computer.id)
                              void move(dragId, zone.id, cell.computer.id);
                            setDragId(null);
                          }
                        : undefined
                    }
                    onClick={
                      edit ? undefined : () => setSelectedId(cell.computer.id)
                    }
                  >
                    {/* Только номер крупной цифрой; статус несёт цвет кольца. */}
                    <span className="pc-num">
                      {pcLabel(cell.computer.name)}
                    </span>
                    {cell.session ? (
                      <span className="pc-timer">
                        {state === "FREE" ? "∞" : clock(remainingMinutes(cell))}
                      </span>
                    ) : state === "RESERVED" ? (
                      <StateIcon kind="reserved" />
                    ) : state === "PAUSED" ? (
                      <StateIcon kind="paused" />
                    ) : null}
                  </button>
                  {guestName && (
                    <span className="pc-name" title={guestName}>
                      {guestName.split(" ")[0]}
                    </span>
                  )}
                </div>
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
