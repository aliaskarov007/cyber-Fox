import { useEffect, useState } from "react";

import { type KaspiProvider, api } from "./api.js";

/**
 * Kaspi.kz напрямую, по договору с Kaspi. Гость открывает в приложении Kaspi
 * «Платежи», находит клуб, вводит свой номер телефона и сумму — деньги сразу
 * на его счёте в клубе, без игрового ПК и без кассы.
 *
 * Здесь — данные, которые Kaspi просит в техническом протоколе: адрес
 * сервера, формат номера и адреса Kaspi, с которых сервер принимает запросы.
 */
export function KaspiProviderSettings({ onSaved }: { onSaved: (message: string) => void }) {
  const [channel, setChannel] = useState<KaspiProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [bin, setBin] = useState("");

  useEffect(() => {
    void api
      .kaspiProvider()
      .then((loaded) => {
        setChannel(loaded);
        setBin(loaded.bin ?? "");
      })
      .catch(() => setChannel(null));
  }, []);

  async function saveBin(): Promise<void> {
    if (!channel) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveKaspiProvider(channel.enabled, bin);
      setChannel(saved);
      setBin(saved.bin ?? "");
      onSaved(saved.bin ? "БИН/ИИН сохранён — Kaspi получит его в каждом ответе" : "БИН/ИИН убран из ответов");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const url = channel?.path ? `${window.location.origin}${channel.path}` : null;

  async function toggle(enabled: boolean, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setChannel(await api.saveKaspiProvider(enabled));
      onSaved(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copy(label: string, value: string): void {
    void navigator.clipboard.writeText(value).then(() => setCopied(label));
  }

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Kaspi.kz — оплата в «Платежах» по номеру телефона</h2>
        {channel?.connected && (
          <span className={`chip ${channel.enabled ? "in-use" : "offline"}`}>
            {channel.enabled ? "включено" : "выключено"}
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      <p className="hint">
        Прямое подключение по договору с Kaspi. Гость платит в приложении Kaspi в разделе «Платежи»,
        вводит номер телефона, на который зарегистрирован в клубе, — и деньги сразу появляются на его
        счёте. Пополнение попадает в кассу клуба, где гость был последний раз.
      </p>

      {!channel?.connected ? (
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => void toggle(true, "Адрес для Kaspi создан — передайте его в Kaspi")}
        >
          Получить адрес для Kaspi
        </button>
      ) : (
        <>
          <div className="section">
            <h3>Что передать в Kaspi</h3>
            <p className="hint">Адрес интерфейса провайдера (HTTPS, метод GET, ответ JSON):</p>
            <div className="checkout-link">{url}</div>
            <div className="actions">
              <button type="button" onClick={() => url && copy("url", url)}>
                {copied === "url" ? "Скопировано" : "Скопировать адрес"}
              </button>
            </div>
            <p className="hint">Регулярное выражение для поля «Номер телефона» (account):</p>
            <div className="checkout-link">{channel.accountRegex}</div>
            <div className="actions">
              <button type="button" onClick={() => copy("regex", channel.accountRegex)}>
                {copied === "regex" ? "Скопировано" : "Скопировать выражение"}
              </button>
            </div>
            <p className="hint">Запросы принимаются только с адресов Kaspi: {channel.allowedIps.join(", ")}</p>

            <label>
              БИН/ИИН получателя (поле bin в ответах Kaspi)
              <input
                inputMode="numeric"
                maxLength={14}
                value={bin}
                onChange={(e) => setBin(e.target.value)}
                placeholder="12 цифр"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={busy || bin.replace(/\s/g, "") === (channel.bin ?? "")}
                onClick={() => void saveBin()}
              >
                Сохранить БИН/ИИН
              </button>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void toggle(
                  !channel.enabled,
                  channel.enabled ? "Приём платежей Kaspi выключен" : "Приём платежей Kaspi включён",
                )
              }
            >
              {channel.enabled ? "Выключить" : "Включить"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
