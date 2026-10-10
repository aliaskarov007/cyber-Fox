import { type FormEvent, useEffect, useState } from "react";

import { type KaspiChannel, api } from "./api.js";

/**
 * Kaspi Pay через ApiPay. Гость пополняет счёт с игрового ПК — счёт приходит
 * ему в Kaspi или показывается QR на сумму, — и деньги зачисляются сами, без
 * кнопки «Деньги пришли» на кассе.
 *
 * Ключи после сохранения не показываются: с ними можно выставлять счета от
 * имени клуба.
 */
export function KaspiSettings({ onSaved }: { onSaved: (message: string) => void }) {
  const [channel, setChannel] = useState<KaspiChannel | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.kaspi().then(setChannel).catch(() => setChannel(null));
  }, []);

  const webhookUrl = channel?.webhookPath ? `${window.location.origin}${channel.webhookPath}` : null;
  // ApiPay шлёт уведомления только на публичный https-домен.
  const publicHttps = window.location.protocol === "https:" && !/^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname);

  async function run(action: () => Promise<KaspiChannel>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setChannel(await action());
      setApiKey("");
      setSecret("");
      onSaved(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await run(
      () =>
        api.saveKaspi({
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(secret.trim() ? { webhookSecret: secret.trim() } : {}),
        }),
      "Kaspi подключён — пополнения с игровых ПК будут зачисляться сами",
    );
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Kaspi Pay — автоматическое пополнение</h2>
        {channel?.connected && (
          <span className={`chip ${channel.enabled ? "in-use" : "offline"}`}>
            {channel.enabled ? "включено" : "выключено"}
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      <p className="hint">
        Работает через сервис ApiPay поверх Kaspi Pay клуба. Гость выбирает сумму на игровом ПК,
        получает счёт в приложении Kaspi или сканирует QR, и деньги сразу появляются на его счёте.
        Это не официальная интеграция Kaspi: если сервис перестанет отвечать, выключите её здесь —
        гостям снова будет показан QR клуба с подтверждением на кассе.
      </p>

      <ol className="hint">
        <li>Зарегистрируйтесь на apipay.kz, заполните анкету бизнеса.</li>
        <li>
          В Kaspi Pay добавьте сотрудника с ролью «Кассир» на <b>отдельный номер</b> и подключите его в
          ApiPay.
        </li>
        <li>В кабинете ApiPay создайте ключ API и вставьте его ниже.</li>
        <li>
          В кабинете ApiPay в настройках уведомлений укажите адрес ниже и вставьте сюда секрет, который
          ApiPay покажет один раз.
        </li>
      </ol>

      {!publicHttps && (
        <div className="notice warn">
          Касса открыта не по https-домену: ApiPay не сможет сообщать об оплате. Подключайте Kaspi, когда
          сервер работает на своём домене.
        </div>
      )}

      {webhookUrl && (
        <div className="section">
          <h3>Адрес для уведомлений ApiPay</h3>
          <div className="checkout-link">{webhookUrl}</div>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(webhookUrl).then(() => setCopied(true));
              }}
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>
        </div>
      )}

      <form className="settings-grid" onSubmit={submit}>
        <label>
          Ключ API
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={channel?.connected ? "сохранён — оставьте пустым" : ""}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label>
          Секрет уведомлений
          <input
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={channel?.connected ? "сохранён — оставьте пустым" : ""}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {channel?.connected ? "Сохранить" : "Подключить"}
        </button>
      </form>

      {channel?.connected && (
        <div className="actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.saveKaspi({ enabled: !channel.enabled }),
                channel.enabled
                  ? "Автоматическое пополнение выключено — гостям показывается QR клуба"
                  : "Автоматическое пополнение включено",
              )
            }
          >
            {channel.enabled ? "Выключить" : "Включить"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Отключить Kaspi? Ключи будут удалены.")) return;
              void run(() => api.disconnectKaspi(), "Kaspi отключён");
            }}
          >
            Отключить
          </button>
          {channel.lastState && channel.lastState !== "ok" && (
            <span className="hint">Последняя проверка: {channel.lastState}</span>
          )}
        </div>
      )}
    </section>
  );
}
