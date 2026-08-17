import { useCallback, useEffect, useMemo, useState } from "react";

import type { Tab } from "./App.js";
import { type Club, type HallCell, type Tariff, api, formatMoney } from "./api.js";
import { SeatPanel } from "./SeatPanel.js";
import { SessionPanel } from "./SessionPanel.js";
import { useRealtime } from "./useRealtime.js";

/** Состояние плитки: то, что админ должен считывать взглядом, не читая текст. */
function cellState(cell: HallCell): string {
  if (cell.session?.status === "PAUSED") return "PAUSED";
  if (cell.session?.onCredit) return "CREDIT";
  if (cell.session) return "IN_USE";
  if (cell.computer.status === "MAINTENANCE") return "MAINTENANCE";
  if (cell.computer.status === "OFFLINE") return "OFFLINE";
  return "IDLE";
}

const STATE_LABEL: Record<string, string> = {
  PAUSED: "пауза",
  CREDIT: "в долг",
  IN_USE: "играет",
  MAINTENANCE: "ремонт",
  OFFLINE: "не на связи",
  IDLE: "свободен",
};

const STATE_CLASS: Record<string, string> = {
  PAUSED: "paused",
  CREDIT: "credit",
  IN_USE: "in-use",
  MAINTENANCE: "maintenance",
  OFFLINE: "offline",
  IDLE: "idle",
};

export function HallScreen({ club, onGoTo }: { club: Club; onGoTo: (tab: Tab) => void }) {
  const [hall, setHall] = useState<HallCell[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Зал загружен хотя бы раз: до этого пустая карта — не пустой клуб. */
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setHall(await api.hall(club.id));
    setLoaded(true);
  }, [club.id]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
    void api.tariffs(club.id).then(setTariffs);
  }, [club.id, refresh]);

  // Экран догоняет состояние сам, а не только по событиям: если сокет отвалится,
  // карта зала не должна застыть.
  useRealtime(() => void refresh());
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
  const freeComputers = hall.filter((c) => c.session === null && c.computer.id !== selectedId);

  return (
    <main>
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
                  className="pc"
                  data-state={state}
                  onClick={() => setSelectedId(cell.computer.id)}
                >
                  <div className="pc-head">
                    <span className="pc-name">{cell.computer.name}</span>
                    <span className={`chip ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
                  </div>

                  {cell.session ? (
                    <div className="pc-body">
                      <span className="pc-guest">
                        {cell.session.guest?.fullName ?? "Без аккаунта"}
                      </span>
                      <span className="pc-line">
                        {cell.session.mode === "PACKAGE"
                          ? `пакет · ${cell.session.packageMinutesLeft ?? 0} мин`
                          : `поминутно · ${cell.session.minutesAffordable ?? 0} мин хватит`}
                      </span>
                      <span className="pc-line">{formatMoney(cell.session.totalCharged)}</span>
                    </div>
                  ) : (
                    <div className="pc-free">Свободен</div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {selected && (
        <>
          <button className="backdrop" aria-label="Закрыть" onClick={() => setSelectedId(null)} />
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
  const steps: Array<{ title: string; hint: string; tab: Tab; action: string }> = [
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
        В клубе пока нет ни одной машины. Три шага ниже — всё, что нужно, чтобы посадить
        первого гостя.
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
