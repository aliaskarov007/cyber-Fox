import { useState } from "react";

import { api } from "./api.js";

/**
 * Отправка сообщения на экран ПК (или всем машинам клуба, если computerId пуст).
 * Появляется у гостя всплывашкой сверху и сама исчезает. Доставка живая: если
 * ПК выключен — не увидит.
 */
export function PcMessageBox({
  clubId,
  computerId,
  placeholder,
}: {
  clubId: string;
  computerId?: string;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send(): Promise<void> {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setNote(null);
    try {
      await api.sendPcMessage(clubId, { computerId, text: body });
      setText("");
      setNote("Отправлено");
      setTimeout(() => setNote(null), 2500);
    } catch (error) {
      setNote((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pc-message-box">
      <input
        value={text}
        placeholder={placeholder}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void send();
        }}
      />
      <button
        className="primary"
        disabled={busy || text.trim() === ""}
        onClick={() => void send()}
      >
        Отправить
      </button>
      {note && <span className="pc-message-note">{note}</span>}
    </div>
  );
}
