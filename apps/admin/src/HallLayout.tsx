import { useMemo, useState } from "react";

import { type Club, type HallCell, api } from "./api.js";

/** Размер поля плана: сетка, по которой расставляются машины. */
const COLUMNS = 12;
const ROWS = 8;

/**
 * План зала: машины стоят там, где стоят в помещении.
 *
 * Обычная сетка по алфавиту не помогает администратору: он смотрит на экран и
 * ищет ПК-14, а перед ним ряды. План снимает этот перевод — то, что светится
 * на экране, стоит на том же месте, что и в зале.
 *
 * Расстановка делается один раз, мышкой. Пока машину не поставили, она ждёт в
 * списке под планом: сваливать нерасставленное в угол поверх друг друга хуже,
 * чем показать отдельно.
 */
export function HallLayout({
  club,
  hall,
  onChanged,
  onPick,
}: {
  club: Club;
  hall: HallCell[];
  onChanged: () => void;
  /** Нажатие по машине вне режима расстановки: открыть карточку. */
  onPick: (computerId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const placed = useMemo(
    () => hall.filter((cell) => cell.computer.posX !== null && cell.computer.posY !== null),
    [hall],
  );
  const waiting = useMemo(
    () => hall.filter((cell) => cell.computer.posX === null || cell.computer.posY === null),
    [hall],
  );

  async function move(computerId: string, posX: number | null, posY: number | null): Promise<void> {
    setError(null);
    try {
      await api.updateComputer(club.id, computerId, { posX, posY });
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function occupant(x: number, y: number): HallCell | undefined {
    return placed.find((cell) => cell.computer.posX === x && cell.computer.posY === y);
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>План зала</h2>
        <span className="count">
          {placed.length} из {hall.length} расставлено
        </span>
        <button type="button" onClick={() => setEditing((current) => !current)}>
          {editing ? "Готово" : "Расставить"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {editing && (
        <div className="note" style={{ marginBottom: 10 }}>
          Перетащите машины на свободные места — так, как они стоят в зале. Чтобы снять машину с
          плана, перетащите её обратно в список внизу.
        </div>
      )}

      <div
        className={`plan ${editing ? "editing" : ""}`}
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
      >
        {Array.from({ length: COLUMNS * ROWS }, (_, index) => {
          const x = index % COLUMNS;
          const y = Math.floor(index / COLUMNS);
          const cell = occupant(x, y);

          return (
            <div
              key={`${x}:${y}`}
              className="plan-cell"
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={() => {
                // Занятое место не отбирается: две машины на одной точке —
                // это план, по которому в зале уже не сориентируешься.
                if (editing && dragged && !cell) void move(dragged, x, y);
                setDragged(null);
              }}
            >
              {cell && (
                <button
                  type="button"
                  className="plan-pc"
                  data-state={cell.session ? (cell.session.onCredit ? "CREDIT" : "IN_USE") : cell.computer.status}
                  draggable={editing}
                  onDragStart={() => setDragged(cell.computer.id)}
                  onClick={() => !editing && onPick(cell.computer.id)}
                  title={`${cell.computer.name} · ${cell.computer.zone.name}`}
                >
                  {cell.computer.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {waiting.length > 0 && (
        <div
          className="plan-waiting"
          onDragOver={(e) => editing && e.preventDefault()}
          onDrop={() => {
            if (editing && dragged) void move(dragged, null, null);
            setDragged(null);
          }}
        >
          <div className="note">Не на плане: {waiting.length}</div>
          <div className="plan-waiting-row">
            {waiting.map((cell) => (
              <button
                key={cell.computer.id}
                type="button"
                className="plan-pc"
                data-state={cell.computer.status}
                draggable={editing}
                onDragStart={() => setDragged(cell.computer.id)}
                onClick={() => !editing && onPick(cell.computer.id)}
              >
                {cell.computer.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
