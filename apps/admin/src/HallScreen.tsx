import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Tab } from "./App.js";
import {
  type Club,
  type HallCell,
  type MapObject,
  type MapObjectKind,
  type Staff,
  type Tariff,
  type Zone,
  api,
  formatMoney,
} from "./api.js";
import { PcMessageBox } from "./PcMessageBox.js";
import { SeatPanel } from "./SeatPanel.js";
import { SessionPanel } from "./SessionPanel.js";
import { SeatRequests } from "./SeatRequests.js";
import { StaffCalls } from "./StaffCalls.js";
import { useRealtime } from "./useRealtime.js";

/*
 * План помещения — единая сетка COLS×ROWS. Всё (зоны-комнаты, рабочие места,
 * стены, служебные области, двери, подписи) хранится в клетках этой сетки, а
 * холст масштабируется под ширину экрана. Поэтому на мониторе кассы и на
 * телефоне план выглядит одинаково, только крупнее или мельче.
 */
const COLS = 48;
const ROWS = 40;
const PC_W = 3;
const PC_H = 3;
const ZONE_W = 12;
const ZONE_H = 10;
const AREA_W = 9;
const AREA_H = 7;
const WALL_W = 10;
const WALL_H = 1;
const DOOR_W = 2;
const DOOR_H = 1;
const LABEL_W = 5;
const LABEL_H = 2;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Стиль абсолютной коробки на холсте: позиция и размер в процентах сетки. */
function boxStyle(b: Box): CSSProperties {
  return {
    left: `${(b.x / COLS) * 100}%`,
    top: `${(b.y / ROWS) * 100}%`,
    width: `${(b.w / COLS) * 100}%`,
    height: `${(b.h / ROWS) * 100}%`,
  };
}

/** Пересекаются ли две коробки (для запрета наложений). */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** Автоместо для зоны без координат — ровной сеткой, чтобы не легли в угол. */
function autoZone(i: number): { x: number; y: number } {
  return {
    x: 1 + (i % 3) * (ZONE_W + 2),
    y: 1 + Math.floor(i / 3) * (ZONE_H + 2),
  };
}

/** Минимальный размер по типу объекта. */
function minW(kind: MapObjectKind | "zone"): number {
  if (kind === "zone") return 5;
  if (kind === "AREA") return 3;
  if (kind === "WALL") return 1;
  return 1;
}
function minH(kind: MapObjectKind | "zone"): number {
  if (kind === "zone") return 4;
  if (kind === "AREA") return 3;
  return 1;
}

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

type DragState = {
  kind: "zone" | "obj" | "pc";
  id: string;
  mode: "move" | "resize";
  moved: boolean;
} & Box;

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

  const canArrange = staff.role === "OWNER" || staff.role === "ADMIN";
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<{ kind: "pc" | "obj"; id: string } | null>(
    null,
  );
  const [arrError, setArrError] = useState<string | null>(null);

  const floorRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ gx: number; gy: number } & Box>({
    gx: 0,
    gy: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });
  const [drag, setDrag] = useState<DragState | null>(null);

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

  /*
   * Раскладка: координаты каждого зала и каждого ПК в клетках сетки. Сохранённые
   * берём как есть (с защитой от старых значений вне поля); нерасставленные
   * раскладываем ровно — зоны сеткой, ПК внутри своей зоны рядами.
   */
  const layout = useMemo(() => {
    const zpos = new Map<string, Box>();
    zoneList.forEach((z, i) => {
      const fit =
        z.posX !== null &&
        z.posY !== null &&
        z.posX >= 0 &&
        z.posX < COLS &&
        z.posY >= 0 &&
        z.posY < ROWS;
      const base = fit
        ? { x: z.posX as number, y: z.posY as number }
        : autoZone(i);
      const w = clamp(z.width ?? ZONE_W, minW("zone"), COLS);
      const h = clamp(z.height ?? ZONE_H, minH("zone"), ROWS);
      zpos.set(z.id, {
        x: clamp(base.x, 0, COLS - w),
        y: clamp(base.y, 0, ROWS - h),
        w,
        h,
      });
    });

    const ppos = new Map<string, Box>();
    const perZone = new Map<string, number>();
    hall.forEach((c) => {
      const comp = c.computer;
      const fit =
        comp.posX !== null &&
        comp.posY !== null &&
        comp.posX >= 0 &&
        comp.posX <= COLS - PC_W &&
        comp.posY >= 0 &&
        comp.posY <= ROWS - PC_H;
      if (fit) {
        ppos.set(comp.id, {
          x: comp.posX as number,
          y: comp.posY as number,
          w: PC_W,
          h: PC_H,
        });
        return;
      }
      const z = zpos.get(comp.zone.id);
      const n = perZone.get(comp.zone.id) ?? 0;
      perZone.set(comp.zone.id, n + 1);
      const per = z ? Math.max(1, Math.floor((z.w - 1) / PC_W)) : 6;
      const bx = z ? z.x + 1 : 1;
      const by = z ? z.y + 2 : 1;
      ppos.set(comp.id, {
        x: clamp(bx + (n % per) * PC_W, 0, COLS - PC_W),
        y: clamp(by + Math.floor(n / per) * PC_H, 0, ROWS - PC_H),
        w: PC_W,
        h: PC_H,
      });
    });
    return { zpos, ppos };
  }, [hall, zoneList]);

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

  // --- Действия ---

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
    const name = window.prompt("Название зоны", "Новая зона");
    if (!name || !name.trim()) return;
    setArrError(null);
    try {
      await api.createZone(club.id, {
        name: name.trim(),
        sortOrder: zoneList.length,
      });
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
   * Добавить объект плана. AREA (служебная комната) и LABEL спрашивают название;
   * стена и дверь — без подписи. Ставим слева сверху, дальше перетаскивается.
   */
  async function addObject(
    kind: MapObjectKind,
    presetText?: string,
  ): Promise<void> {
    let text: string | undefined = presetText;
    if ((kind === "LABEL" || kind === "AREA") && presetText === undefined) {
      const hint = kind === "AREA" ? "Коридор" : "Ресепшн";
      const entered = window.prompt(
        kind === "AREA" ? "Название служебной комнаты" : "Название места",
        hint,
      );
      if (entered === null) return;
      text = entered.trim() || hint;
    }
    const size: Record<MapObjectKind, { w: number; h: number }> = {
      LABEL: { w: LABEL_W, h: LABEL_H },
      WALL: { w: WALL_W, h: WALL_H },
      AREA: { w: AREA_W, h: AREA_H },
      DOOR: { w: DOOR_W, h: DOOR_H },
    };
    setArrError(null);
    try {
      const created = await api.createMapObject(club.id, {
        kind,
        text,
        posX: 2,
        posY: 2,
        width: size[kind].w,
        height: size[kind].h,
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

  /*
   * После перетаскивания НЕ перезагружаем весь план: это 3 лишних запроса на
   * каждое движение, и за десяток перестановок упираемся в защиту от частых
   * запросов. Вместо этого правим состояние локально, а на сервер шлём один
   * тихий запрос. Полную перезагрузку делаем только если сервер отказал.
   */
  async function saveZoneBox(id: string, b: Box): Promise<void> {
    setArrError(null);
    setZoneList((prev) =>
      prev.map((z) =>
        z.id === id
          ? { ...z, posX: b.x, posY: b.y, width: b.w, height: b.h }
          : z,
      ),
    );
    try {
      await api.updateZone(club.id, id, {
        posX: b.x,
        posY: b.y,
        width: b.w,
        height: b.h,
      });
    } catch (error) {
      setArrError((error as Error).message);
      await refresh();
    }
  }

  async function saveObjBox(id: string, b: Box): Promise<void> {
    setArrError(null);
    setObjects((prev) =>
      prev.map((o) =>
        o.id === id
          ? { ...o, posX: b.x, posY: b.y, width: b.w, height: b.h }
          : o,
      ),
    );
    try {
      await api.updateMapObject(club.id, id, {
        posX: b.x,
        posY: b.y,
        width: b.w,
        height: b.h,
      });
    } catch (error) {
      setArrError((error as Error).message);
      await refresh();
    }
  }

  /** Перенос рабочего места: позиция + зона той комнаты, куда его положили. */
  async function savePc(id: string, x: number, y: number): Promise<void> {
    const cell = hall.find((c) => c.computer.id === id);
    if (!cell) return;
    const center = { x: x + PC_W / 2, y: y + PC_H / 2 };
    let zone = cell.computer.zone;
    for (const z of zoneList) {
      const b = layout.zpos.get(z.id);
      if (
        b &&
        center.x >= b.x &&
        center.x <= b.x + b.w &&
        center.y >= b.y &&
        center.y <= b.y + b.h
      ) {
        zone = { id: z.id, name: z.name };
        break;
      }
    }
    setArrError(null);
    setHall((prev) =>
      prev.map((c) =>
        c.computer.id === id
          ? { ...c, computer: { ...c.computer, posX: x, posY: y, zone } }
          : c,
      ),
    );
    try {
      await api.arrangeComputers(club.id, [
        { id, zoneId: zone.id, posX: x, posY: y },
      ]);
    } catch (error) {
      setArrError((error as Error).message);
      await refresh();
    }
  }

  // --- Перетаскивание и изменение размера по сетке ---

  function boxOf(kind: DragState["kind"], id: string): Box {
    if (kind === "zone")
      return layout.zpos.get(id) ?? { x: 1, y: 1, w: ZONE_W, h: ZONE_H };
    if (kind === "pc")
      return layout.ppos.get(id) ?? { x: 1, y: 1, w: PC_W, h: PC_H };
    const o = objects.find((x) => x.id === id);
    return o
      ? {
          x: clamp(o.posX, 0, COLS - 1),
          y: clamp(o.posY, 0, ROWS - 1),
          w: o.width,
          h: o.height,
        }
      : { x: 2, y: 2, w: 2, h: 2 };
  }

  function startDrag(
    e: ReactPointerEvent,
    kind: DragState["kind"],
    id: string,
    mode: "move" | "resize",
  ): void {
    if (!edit) return;
    e.preventDefault();
    e.stopPropagation();
    const floor = floorRef.current;
    if (!floor) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = floor.getBoundingClientRect();
    const box = boxOf(kind, id);
    dragStart.current = {
      gx: (e.clientX - r.left) / (r.width / COLS),
      gy: (e.clientY - r.top) / (r.height / ROWS),
      ...box,
    };
    setDrag({ kind, id, mode, moved: false, ...box });
  }

  function onMove(e: ReactPointerEvent): void {
    if (!drag) return;
    const floor = floorRef.current;
    if (!floor) return;
    const r = floor.getBoundingClientRect();
    const gx = (e.clientX - r.left) / (r.width / COLS);
    const gy = (e.clientY - r.top) / (r.height / ROWS);
    const s = dragStart.current;
    const kindMin: MapObjectKind | "zone" =
      drag.kind === "zone"
        ? "zone"
        : drag.kind === "obj"
          ? (objects.find((o) => o.id === drag.id)?.kind ?? "AREA")
          : "AREA";
    if (drag.mode === "move") {
      const x = clamp(Math.round(s.x + (gx - s.gx)), 0, COLS - drag.w);
      const y = clamp(Math.round(s.y + (gy - s.gy)), 0, ROWS - drag.h);
      // «Перемещением» считаем только реальную смену клетки — иначе тап по ПК
      // не откроет панель из-за микродрожания пальца.
      setDrag((d) =>
        d ? { ...d, x, y, moved: d.moved || x !== s.x || y !== s.y } : d,
      );
    } else {
      const w = clamp(
        Math.round(s.w + (gx - s.gx)),
        minW(kindMin),
        COLS - drag.x,
      );
      const h = clamp(
        Math.round(s.h + (gy - s.gy)),
        minH(kindMin),
        ROWS - drag.y,
      );
      setDrag((d) =>
        d ? { ...d, w, h, moved: d.moved || w !== s.w || h !== s.h } : d,
      );
    }
  }

  function endDrag(): void {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const box: Box = { x: d.x, y: d.y, w: d.w, h: d.h };

    if (!d.moved) {
      // Нажатие без перемещения — выбор элемента.
      if (d.kind === "pc") setSel({ kind: "pc", id: d.id });
      else if (d.kind === "obj") setSel({ kind: "obj", id: d.id });
      return;
    }

    if (d.kind === "zone") {
      const clash = zoneList.some(
        (z) => z.id !== d.id && overlaps(box, layout.zpos.get(z.id) as Box),
      );
      if (clash) {
        setArrError("Зоны не должны накладываться — поставьте рядом");
        void refresh();
        return;
      }
      void saveZoneBox(d.id, box);
    } else if (d.kind === "pc") {
      const clash = hall.some(
        (c) =>
          c.computer.id !== d.id &&
          overlaps(box, layout.ppos.get(c.computer.id) as Box),
      );
      if (clash) {
        setArrError("Здесь уже стоит ПК — выберите свободное место");
        void refresh();
        return;
      }
      void savePc(d.id, d.x, d.y);
    } else {
      void saveObjBox(d.id, box);
    }
  }

  const selObj =
    sel?.kind === "obj" ? (objects.find((o) => o.id === sel.id) ?? null) : null;
  const selPc =
    sel?.kind === "pc"
      ? (hall.find((c) => c.computer.id === sel.id) ?? null)
      : null;

  const dragBox = (kind: DragState["kind"], id: string, fallback: Box): Box =>
    drag && drag.kind === kind && drag.id === id
      ? { x: drag.x, y: drag.y, w: drag.w, h: drag.h }
      : fallback;

  const areas = objects.filter((o) => o.kind === "AREA");
  const walls = objects.filter((o) => o.kind === "WALL");
  const marks = objects.filter((o) => o.kind === "LABEL" || o.kind === "DOOR");

  return (
    <main>
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

      {hall.length > 0 && (
        <div className="hall-broadcast">
          <span className="hall-broadcast-label">Сообщение всем ПК:</span>
          <PcMessageBox clubId={club.id} placeholder="Текст всем игрокам…" />
        </div>
      )}

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
              <button onClick={() => void addZone()}>+ Зона</button>
              <button onClick={() => void addObject("WALL")}>+ Стена</button>
              <button onClick={() => void addObject("DOOR", "Дверь")}>
                + Дверь
              </button>
              <button onClick={() => void addObject("AREA")}>
                + Служебная
              </button>
              {["Reception", "WC", "Entrance"].map((t) => (
                <button key={t} onClick={() => void addObject("LABEL", t)}>
                  + {t}
                </button>
              ))}
              <button onClick={() => void addObject("LABEL")}>
                + Подпись…
              </button>
              <span className="hall-arrange-hint">
                Тащи зоны и места за уголок с точками (⠿), размер — за уголок ◢.
                Положишь ПК в комнату — он станет её зоны (тариф применится
                сам). Стенами делишь зал.
              </span>
            </>
          )}
        </div>
      )}
      {edit && arrError && <div className="error">{arrError}</div>}

      {edit && selPc && (
        <div className="map-sel">
          <b>{selPc.computer.name}</b>
          <label>
            Зона
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
          {selObj.kind === "LABEL" || selObj.kind === "AREA" ? (
            <input
              className="zone-rename"
              defaultValue={selObj.text ?? ""}
              placeholder={
                selObj.kind === "AREA"
                  ? "Коридор, серверная, склад…"
                  : "Ресепшн, вход…"
              }
              onBlur={(e) => void renameObj(selObj.id, e.target.value)}
            />
          ) : (
            <b>{selObj.kind === "WALL" ? "Стена" : "Дверь"}</b>
          )}
          <button className="danger" onClick={() => void deleteObj(selObj.id)}>
            Удалить
          </button>
          <button onClick={() => setSel(null)}>Закрыть</button>
        </div>
      )}

      {(hall.length > 0 || objects.length > 0 || edit) && (
        <div className={`fp-wrap ${edit ? "editing" : ""}`}>
          {/* Обработчики перетаскивания — только на самих элементах (они
             захватывают указатель). На холсте их нет, иначе событие всплывало
             бы и срабатывало дважды — двойной запрос на каждое движение. */}
          <div className="fp" ref={floorRef}>
            {/* Служебные комнаты — фоном под всем. */}
            {areas.map((o) => {
              const b = dragBox("obj", o.id, {
                x: clamp(o.posX, 0, COLS - 1),
                y: clamp(o.posY, 0, ROWS - 1),
                w: o.width,
                h: o.height,
              });
              return (
                <div
                  key={o.id}
                  className={`fp-area ${sel?.id === o.id ? "sel" : ""}`}
                  style={boxStyle(b)}
                >
                  {edit && (
                    <span
                      className="fp-grip"
                      onPointerDown={(e) => startDrag(e, "obj", o.id, "move")}
                      onPointerMove={onMove}
                      onPointerUp={endDrag}
                    >
                      ⠿
                    </span>
                  )}
                  <span
                    className="fp-area-name"
                    onPointerDown={
                      edit
                        ? (e) => startDrag(e, "obj", o.id, "move")
                        : undefined
                    }
                    onPointerUp={edit ? endDrag : undefined}
                  >
                    {o.text || "Служебная"}
                  </span>
                  {edit && (
                    <span
                      className="fp-resize"
                      onPointerDown={(e) => startDrag(e, "obj", o.id, "resize")}
                      onPointerMove={onMove}
                      onPointerUp={endDrag}
                    >
                      ◢
                    </span>
                  )}
                </div>
              );
            })}

            {/* Зоны-комнаты. */}
            {zoneList.map((zone) => {
              const base = layout.zpos.get(zone.id) as Box;
              const b = dragBox("zone", zone.id, base);
              const pcs = hall.filter((c) => c.computer.zone.id === zone.id);
              return (
                <section
                  key={zone.id}
                  className={`fp-zone ${drag?.kind === "zone" && drag.id === zone.id ? "dragging" : ""}`}
                  style={
                    {
                      ...boxStyle(b),
                      "--zc": zoneColor(zone.id),
                    } as CSSProperties
                  }
                >
                  <div className="fp-head">
                    {edit && (
                      <span
                        className="fp-grip"
                        title="Перетащить зону"
                        onPointerDown={(e) =>
                          startDrag(e, "zone", zone.id, "move")
                        }
                        onPointerMove={onMove}
                        onPointerUp={endDrag}
                      >
                        ⠿
                      </span>
                    )}
                    {edit ? (
                      <input
                        className="zone-rename"
                        defaultValue={zone.name}
                        key={zone.name}
                        aria-label="Название зоны"
                        onBlur={(e) => void renameZone(zone.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <span className="fp-zone-name">{zone.name}</span>
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
                  {edit && (
                    <span
                      className="fp-resize"
                      title="Размер зоны"
                      onPointerDown={(e) =>
                        startDrag(e, "zone", zone.id, "resize")
                      }
                      onPointerMove={onMove}
                      onPointerUp={endDrag}
                    >
                      ◢
                    </span>
                  )}
                </section>
              );
            })}

            {/* Стены-перегородки. */}
            {walls.map((o) => {
              const b = dragBox("obj", o.id, {
                x: clamp(o.posX, 0, COLS - 1),
                y: clamp(o.posY, 0, ROWS - 1),
                w: o.width,
                h: o.height,
              });
              return (
                <div
                  key={o.id}
                  className={`fp-wall ${sel?.id === o.id ? "sel" : ""}`}
                  style={boxStyle(b)}
                  onPointerDown={
                    edit ? (e) => startDrag(e, "obj", o.id, "move") : undefined
                  }
                  onPointerMove={edit ? onMove : undefined}
                  onPointerUp={edit ? endDrag : undefined}
                >
                  {edit && (
                    <span
                      className="fp-resize"
                      onPointerDown={(e) => startDrag(e, "obj", o.id, "resize")}
                      onPointerMove={onMove}
                      onPointerUp={endDrag}
                    >
                      ◢
                    </span>
                  )}
                </div>
              );
            })}

            {/* Рабочие места. */}
            {hall.map((cell) => {
              const b = dragBox(
                "pc",
                cell.computer.id,
                layout.ppos.get(cell.computer.id) as Box,
              );
              const state = cellState(cell);
              const guestName = cell.session?.guest?.fullName ?? null;
              return (
                <button
                  key={cell.computer.id}
                  className={`pc fp-pc ${calls[cell.computer.id] ? "calling" : ""} ${edit ? "editing" : ""} ${sel?.id === cell.computer.id ? "sel" : ""}`}
                  data-state={state}
                  title={tileTitle(cell, state)}
                  style={
                    {
                      ...boxStyle(b),
                      "--zc": zoneColor(cell.computer.zone.id),
                    } as CSSProperties
                  }
                  onClick={
                    edit ? undefined : () => setSelectedId(cell.computer.id)
                  }
                  onPointerDown={
                    edit
                      ? (e) => startDrag(e, "pc", cell.computer.id, "move")
                      : undefined
                  }
                  onPointerMove={edit ? onMove : undefined}
                  onPointerUp={edit ? endDrag : undefined}
                >
                  <span className="pc-zone" />
                  <span className="pc-num">{pcLabel(cell.computer.name)}</span>
                  {guestName && <span className="pc-name">{guestName}</span>}
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
              );
            })}

            {/* Двери и подписи-мебель — поверх. */}
            {marks.map((o) => {
              const b = dragBox("obj", o.id, {
                x: clamp(o.posX, 0, COLS - 1),
                y: clamp(o.posY, 0, ROWS - 1),
                w: o.width,
                h: o.height,
              });
              return (
                <div
                  key={o.id}
                  className={`${o.kind === "DOOR" ? "fp-door" : "fp-label"} ${sel?.id === o.id ? "sel" : ""}`}
                  style={boxStyle(b)}
                  onPointerDown={
                    edit ? (e) => startDrag(e, "obj", o.id, "move") : undefined
                  }
                  onPointerMove={edit ? onMove : undefined}
                  onPointerUp={edit ? endDrag : undefined}
                >
                  {o.kind === "DOOR" ? "" : o.text || "Подпись"}
                </div>
              );
            })}
          </div>
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
