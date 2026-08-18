import { type FormEvent, useState } from "react";

import { type ClubApp, type ClubAppInput, type Club, type Zone, api } from "./api.js";
import { pointsAtSteamItself, steamCoverUrl } from "./steam-cover.js";

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
  apps,
  editing,
  onClose,
  onSaved,
}: {
  club: Club;
  zones: Zone[];
  /** Что уже на полках: нужно, чтобы предупредить о повторе. */
  apps: ClubApp[];
  editing: ClubApp | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [kind, setKind] = useState<"EXECUTABLE" | "URI">(editing?.kind ?? "EXECUTABLE");
  const [section, setSection] = useState<"GAME" | "APP">(editing?.section ?? "GAME");
  const [target, setTarget] = useState(editing?.target ?? "");
  const [args, setArgs] = useState(editing?.args.join(" ") ?? "");
  const [coverUrl, setCoverUrl] = useState(editing?.coverUrl ?? "");
  const [zoneId, setZoneId] = useState(editing?.zoneId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Идёт отправка картинки: файл на пару мегабайт летит не мгновенно. */
  const [uploading, setUploading] = useState(false);

  /** Подсказка обложки появляется, только если поле пустое: своё не затираем. */
  const suggested = coverUrl.trim() === "" ? steamCoverUrl(target, args) : null;

  /*
   * Путь в сам Steam вместо игры — самая частая ошибка при заполнении руками.
   * Плитка откроет клиент Steam, и гость будет искать игру сам: ровно то, ради
   * ухода от чего полки и делались.
   */
  const opensSteamItself = pointsAtSteamItself(target, args);

  /** Похожее название уже на полке: три плитки одной игры гостю не помогают. */
  const duplicate = apps.find(
    (app) => app.id !== editing?.id && app.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const preview = coverUrl.trim() === "" ? suggested : coverUrl.trim();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: ClubAppInput = {
        name: name.trim(),
        kind,
        section,
        target: target.trim(),
        args: args.trim() === "" ? [] : args.trim().split(/\s+/),
        // Пустая зона означает «во всех», а не «зона не выбрана».
        zoneId: zoneId === "" ? null : zoneId,
        /*
         * Пустые поля отправляются пустой строкой, а не пропускаются. Сервер
         * различает «не присылали» и «прислали пусто»: пропуск оставил бы
         * прежнее значение, и очистить полку или обложку было бы нечем.
         */
        category: category.trim(),
        coverUrl: preview ?? "",
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
        {/* Вкладка в оболочке: за игрой приходят, браузер открывают между делом. */}
        Где показывать
        <select value={section} onChange={(e) => setSection(e.target.value as "GAME" | "APP")}>
          <option value="GAME">Игры</option>
          <option value="APP">Приложения</option>
        </select>
      </label>

      <label>
        Жанр
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
        {/*
         * У игр из сборок ссылки на обложку не существует, а искать похожую по
         * названию администратору некогда. Поэтому картинку можно просто
         * загрузить — она ляжет рядом с сервером и встанет на плитку.
         */}
        Или загрузить картинку
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            setError(null);
            api
              .uploadCover(club.id, file)
              .then((result) => setCoverUrl(result.url))
              .catch((cause: Error) => setError(cause.message))
              .finally(() => setUploading(false));
          }}
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

      {opensSteamItself && (
        <div className="notice warn">
          Этот путь открывает сам Steam, а не игру. Гостю придётся искать её в библиотеке.
          Укажите вместо пути ссылку запуска <code>steam://rungameid/730</code> — число берётся из
          адреса игры в магазине Steam. Тогда подставится и обложка.
        </div>
      )}

      {duplicate && (
        <div className="notice">
          Игра с таким названием уже есть на полках: «{duplicate.name}». Проверьте, не заводите ли
          её второй раз — гость увидит две одинаковые плитки.
        </div>
      )}

      {preview && (
        <div className="cover-preview">
          {/* Битая ссылка прячет картинку: пустая рамка честнее сломанной иконки. */}
          <img src={preview} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        </div>
      )}

      <div className="actions">
        <button className="primary" type="submit" disabled={busy || uploading}>
          {editing ? "Сохранить" : "Добавить"}
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
