import { type FormEvent, useEffect, useState } from "react";

import { type Club, type Computer, type Zone, api } from "./api.js";

const STATUS_LABEL: Record<Computer["status"], string> = {
  OFFLINE: "не на связи",
  IDLE: "свободна",
  IN_USE: "занята",
  RESERVED: "бронь",
  MAINTENANCE: "ремонт",
};

/**
 * Машины зала.
 *
 * В бездисковом зале машины заводятся сами при первой загрузке, и этот экран
 * нужен только чтобы расставить их по зонам и переименовать. В зале с дисками
 * другого пути нет: машину заводят здесь и вводят её код привязки в агента.
 */
export function ComputersSection({ club }: { club: Club }) {
  const [computers, setComputers] = useState<Computer[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [name, setName] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [nextComputers, nextZones] = await Promise.all([api.computers(club.id), api.zones(club.id)]);
    setComputers(nextComputers);
    setZones(nextZones);
    if (nextZones.length > 0) setZoneId((current) => current || nextZones[0].id);
  }

  useEffect(() => {
    void load();
  }, [club.id]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === "" || zoneId === "") return;
    await run(async () => {
      await api.createComputer(club.id, { name: name.trim(), zoneId });
      setName("");
    });
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Машины</h2>
        <span className="count">{computers.length}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Машина</th>
              <th>Зона</th>
              <th>Состояние</th>
              <th>Код привязки</th>
            </tr>
          </thead>
          <tbody>
            {computers.map((computer) => (
              <tr key={computer.id}>
                <td>
                  <ComputerNameCell
                    club={club}
                    computer={computer}
                    onRenamed={() => void load()}
                    onError={setError}
                  />
                </td>
                <td>
                  {/*
                   * Зона машины меняется прямо здесь: после первой загрузки
                   * бездискового зала все машины оказываются в первой зоне, и
                   * расставить сорок штук иначе негде.
                   */}
                  <select
                    value={computer.zoneId}
                    disabled={busy}
                    onChange={(e) =>
                      void run(() =>
                        api.updateComputer(club.id, computer.id, { zoneId: e.target.value }),
                      )
                    }
                  >
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{STATUS_LABEL[computer.status]}</td>
                <td className="num">{computer.pairingToken ?? "по MAC"}</td>
              </tr>
            ))}
            {computers.length === 0 && (
              <tr>
                <td colSpan={4}>
                  Машин нет. В бездисковом зале они появятся сами при первой загрузке; в зале с
                  дисками заведите их здесь.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="settings-grid" onSubmit={create}>
        <label>
          Новая машина
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="PC-01" />
        </label>
        <label>
          Зона
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy || zones.length === 0}>
          Добавить машину
        </button>
      </form>

      {zones.length === 0 && (
        <div className="notice">Сначала заведите зону — машина всегда стоит в какой-то зоне.</div>
      )}
    </section>
  );
}

/**
 * Имя машины с правкой на месте: клик по «Переименовать» превращает ячейку в
 * поле ввода. Имя уникально в клубе — сервер вернёт ошибку при совпадении.
 */
function ComputerNameCell({
  club,
  computer,
  onRenamed,
  onError,
}: {
  club: Club;
  computer: Computer;
  onRenamed: () => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(computer.name);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    const next = name.trim();
    if (next === "" || next === computer.name) {
      setEditing(false);
      setName(computer.name);
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await api.updateComputer(club.id, computer.id, { name: next });
      setEditing(false);
      onRenamed();
    } catch (cause) {
      onError((cause as Error).message);
      setName(computer.name);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="name-cell">
        {computer.name}
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Переименовать
        </button>
      </span>
    );
  }

  return (
    <span className="name-cell">
      <input
        autoFocus
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setEditing(false);
            setName(computer.name);
          }
        }}
      />
      <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
        ОК
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setEditing(false);
          setName(computer.name);
        }}
      >
        Отмена
      </button>
    </span>
  );
}
