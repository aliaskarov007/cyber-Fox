import { type FormEvent, useState } from "react";

import { type ClubApp, type ClubAppInput, type Club, type Zone, api } from "./api.js";
import { steamCoverUrl } from "./steam-cover.js";

/**
 * Заведение и правка игры.
 *
 * Путь запуска и обложка связаны: для Steam-игры хватает ссылки вида
 * steam://rungameid/730, обложка подставляется сама. Всё остальное описывается
 * путём к программе на машине зала — он одинаков на всех машинах, потому что
 * образ общий.
 */
export function LibraryForm({
  club,
  zones,
  editing,
  onClose,
  onSaved,
}: {
  club: Club;
  zones: Zone[];
  editing: ClubApp | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [kind, setKind] = useState<"EXECUTABLE" | "URI">(editing?.kind ?? "EXECUTABLE");
  const [target, setTarget] = useState(editing?.target ?? "");
  const [args, setArgs] = useState(editing?.args.join(" ") ?? "");
  const [coverUrl, setCoverUrl] = useState(editing?.coverUrl ?? "");
  const [zoneId, setZoneId] = useState(editing?.zoneId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Подсказка обложки появляется, только если поле пустое: своё не затираем. */
  const suggested = coverUrl.trim() === "" ? steamCoverUrl(target) : null;
  const preview = coverUrl.trim() === "" ? suggested : coverUrl.trim();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: ClubAppInput = {
        name: name.trim(),
        kind,
        target: target.trim(),
        args: args.trim() === "" ? [] : args.trim().split(/\s+/),
        // Пустая зона означает «во всех», а не «зона не выбрана».
        zoneId: zoneId === "" ? null : zoneId,
        ...(category.trim() === "" ? {} : { category: category.trim() }),
        ...(preview ? { coverUrl: preview } : {}),
      };
      if (editing) await api.updateApp(club.id, editing.id, body);
      else await api.createApp(club.id, body);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      {error && <div className="error">{error}</div>}

      <label>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Counter-Strike 2" />
      </label>

      <label>
        Полка
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Шутеры" />
      </label>

      <label>
        Чем запускается
        <select value={kind} onChange={(e) => setKind(e.target.value as "EXECUTABLE" | "URI")}>
          <option value="EXECUTABLE">Программа на машине</option>
          <option value="URI">Ссылка (Steam, Epic)</option>
        </select>
      </label>

      <label>
        {kind === "URI" ? "Ссылка запуска" : "Путь к программе"}
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={kind === "URI" ? "steam://rungameid/730" : "C:\\Games\\game.exe"}
        />
      </label>

      <label>
        Аргументы (через пробел, если нужны)
        <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-novid -high" />
      </label>

      <label>
        Обложка, ссылка
        <input
          value={coverUrl}
          onChange={(e) => setCoverUrl(e.target.value)}
          placeholder={suggested ? "подставится со Steam" : "https://…"}
        />
      </label>

      <label>
        Зона
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">во всех зонах</option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              только {zone.name}
            </option>
          ))}
        </select>
      </label>

      {preview && (
        <div className="cover-preview">
          {/* Битая ссылка прячет картинку: пустая рамка честнее сломанной иконки. */}
          <img src={preview} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        </div>
      )}

      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {editing ? "Сохранить" : "Добавить"}
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
