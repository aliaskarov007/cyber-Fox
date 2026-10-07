import { type FormEvent, useEffect, useState } from "react";

import { type WhatsAppChannel, api } from "./api.js";

const STATE_LABEL: Record<string, string> = {
  authorized: "подключён",
  notAuthorized: "нужно отсканировать QR",
  blocked: "номер заблокирован WhatsApp",
  sleepMode: "телефон не в сети",
  starting: "запускается",
  yellowCard: "ограничен за рассылку",
};

/**
 * Подключение номера сети к WhatsApp через Green-API.
 *
 * Один номер на всю сеть: на него гости пишут код регистрации с экрана ПК,
 * с него уходят приглашения, на него приходят ответы. Токен после сохранения
 * не показывается — с ним можно писать от имени клуба.
 */
export function WhatsappSection() {
  const [notice, setNotice] = useState<string | null>(null);
  const onSaved = (message: string) => setNotice(message);
  const [channel, setChannel] = useState<WhatsAppChannel | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    void api.whatsapp().then((c) => {
      setChannel(c);
      setApiUrl(c.apiUrl ?? "");
      setInstanceId(c.instanceId ?? "");
    });
  }, []);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void run(async () => {
      // Ответы гостей Green-API шлёт на адрес, с которого открыта касса. Если это
      // локальная сеть клуба, до неё снаружи не достучаться — тогда не передаём.
      const origin = window.location.origin;
      const isPublic = origin.startsWith("https://") && !/\/\/(localhost|\d+\.\d+\.\d+\.\d+)/.test(origin);
      const saved = await api.saveWhatsApp({
        instanceId: instanceId.trim(),
        ...(apiUrl.trim() ? { apiUrl: apiUrl.trim() } : {}),
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
        ...(isPublic ? { publicUrl: origin } : {}),
      });
      setChannel(saved);
      setApiToken("");
      setWarning(saved.warning);
      onSaved("WhatsApp подключён");
    });
  }

  const state = channel?.state ?? null;

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>WhatsApp</h2>
        {channel?.connected && (
          <span className={`chip ${state === "authorized" ? "in-use" : "maintenance"}`}>
            {state ? (STATE_LABEL[state] ?? state) : "не проверен"}
          </span>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {warning && <div className="notice warn">{warning}</div>}
      {notice && !error && <div className="notice">{notice}</div>}

      {channel?.connected && (
        <div className="rows">
          <div className="row">
            <span className="k">Номер клуба</span>
            {/* Номер нужен регистрации за ПК: без него экран не покажет QR. */}
            <span>{channel.phone ? `+${channel.phone}` : "станет известен после привязки по QR"}</span>
          </div>
          <div className="row">
            <span className="k">Последнее сообщение от гостя</span>
            {/* Пусто после регистрации гостя — значит, сообщения до сервера не доходят. */}
            <span>
              {channel.lastIncomingAt ? new Date(channel.lastIncomingAt).toLocaleString("ru-RU") : "ещё не приходило"}
            </span>
          </div>
        </div>
      )}

      <div className="notice">
        На этот номер гости пишут код регистрации с экрана ПК, с него уходят приглашения на ивенты
        афиши. Заведите инстанс в кабинете green-api.com, привяжите к нему телефон клуба по QR-коду
        (WhatsApp Business → Связанные устройства) и перенесите сюда idInstance и apiTokenInstance.
        Лучше отдельный номер: личный WhatsApp за рассылки могут ограничить.
      </div>

      <form className="settings-grid" onSubmit={submit}>
        <label>
          idInstance
          <input inputMode="numeric" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} />
        </label>
        <label>
          apiTokenInstance
          <input
            type="password"
            autoComplete="off"
            value={apiToken}
            placeholder={channel?.apiTokenHint ? `сохранён (${channel.apiTokenHint})` : ""}
            onChange={(e) => setApiToken(e.target.value)}
          />
        </label>
        <label>
          apiUrl (если указан в кабинете)
          <input
            value={apiUrl}
            placeholder="https://api.green-api.com"
            onChange={(e) => setApiUrl(e.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={busy || !instanceId.trim()}>
          {channel?.connected ? "Сохранить" : "Подключить"}
        </button>
      </form>

      {channel?.connected && (
        <div className="actions" style={{ marginTop: 12 }}>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setChannel(await api.checkWhatsApp());
              })
            }
          >
            Проверить состояние
          </button>
          <input
            style={{ width: 200 }}
            placeholder="+7 701 000 00 00"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            aria-label="Номер для проверки"
          />
          <button
            disabled={busy || testPhone.trim().length < 5}
            onClick={() =>
              void run(async () => {
                await api.testWhatsApp(testPhone);
                onSaved("Проверочное сообщение отправлено");
              })
            }
          >
            Отправить проверку
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Отключить WhatsApp? Коды и приглашения перестанут уходить.")) return;
              void run(async () => {
                setChannel(await api.disconnectWhatsApp());
                setInstanceId("");
                setApiUrl("");
                setWarning(null);
                onSaved("WhatsApp отключён");
              });
            }}
          >
            Отключить
          </button>
        </div>
      )}
    </section>
  );
}
