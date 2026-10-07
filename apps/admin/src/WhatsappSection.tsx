import { useEffect, useState } from "react";

import { type WhatsappStatus, api } from "./api.js";

/**
 * Подключение WhatsApp: что вписано на сервере и доходят ли сообщения.
 *
 * У Meta подключение настраивают руками, а снаружи любая ошибка выглядит
 * одинаково — гость отправил код, а экран ПК ждёт. Здесь видно, на каком шаге
 * застряло (docs/guest-access.md, «Подключение WhatsApp»).
 */
export function WhatsappSection() {
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setStatus(await api.whatsappStatus());
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const origin = window.location.origin;
  const webhook = `${origin}/api/whatsapp/webhook`;
  const privacy = `${origin}/api/whatsapp/privacy`;

  function copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const time = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "";

  const signatureBroken =
    status?.lastSignatureFailureAt &&
    (!status.lastMessageAt || status.lastSignatureFailureAt > status.lastMessageAt);
  const state = !status
    ? null
    : !status.active
      ? { chip: "idle", text: "не подключено" }
      : signatureBroken
        ? { chip: "offline", text: "сообщения отклоняются" }
        : status.lastMessageAt
          ? { chip: "in-use", text: "работает" }
          : { chip: "paused", text: "ждём проверочное сообщение" };

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>WhatsApp: подтверждение номера</h2>
        {state && <span className={`chip ${state.chip}`}>{state.text}</span>}
        <button type="button" onClick={() => void load()}>
          Обновить
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {status && (
        <div className="rows">
          <Check ok={status.number !== null} label="Номер клуба на сервере" detail={status.number ?? "не вписан (WHATSAPP_NUMBER)"} />
          <Check ok={status.hasAppSecret} label="App Secret" detail={status.hasAppSecret ? "вписан" : "не вписан (WHATSAPP_APP_SECRET)"} />
          <Check
            ok={status.hasVerifyToken}
            label="Слово-пароль для проверки адреса"
            detail={status.hasVerifyToken ? "вписано" : "не вписано (WHATSAPP_VERIFY_TOKEN)"}
          />
          <div className="row">
            <span className="k">Адрес для Meta (Callback URL)</span>
            <span>
              <code>{webhook}</code>{" "}
              <button type="button" onClick={() => copy(webhook)}>
                {copied === webhook ? "Скопировано" : "Копировать"}
              </button>
            </span>
          </div>
          <div className="row">
            <span className="k">Политика конфиденциальности для Meta</span>
            <span>
              <code>{privacy}</code>{" "}
              <button type="button" onClick={() => copy(privacy)}>
                {copied === privacy ? "Скопировано" : "Копировать"}
              </button>
            </span>
          </div>
          <Check
            ok={status.lastVerifiedAt !== null}
            label="Meta проверила адрес"
            detail={status.lastVerifiedAt ? time(status.lastVerifiedAt) : "ещё нет — нажмите Verify в настройках вебхука у Meta"}
          />
          <Check
            ok={status.lastMessageAt !== null}
            label="Последнее сообщение"
            detail={
              status.lastMessageAt
                ? `${time(status.lastMessageAt)} с номера ${status.lastMessageFrom ?? ""}`
                : "ещё не было — напишите «проверка» на номер клуба"
            }
          />
        </div>
      )}

      {signatureBroken && (
        <div className="error">
          Meta присылает сообщения, но подпись не сходится ({time(status!.lastSignatureFailureAt)}). Почти
          всегда это не тот App Secret: скопируйте его заново из App settings → Basic и перезапустите
          сервер.
        </div>
      )}

      {status?.active && !status.lastMessageAt && !signatureBroken && (
        <div className="notice">
          Сервер готов принимать сообщения. Если «проверка» не появляется: у Meta вебхук должен быть
          подписан на поле messages, а приложение — переведено из Development в Live. Отметки
          сбрасываются при перезапуске сервера.
        </div>
      )}

      {!status?.active && (
        <div className="notice">
          Пока WhatsApp не подключён, регистрация на ПК работает без него: номер нового гостя
          подтверждает администратор в карточке гостя.
        </div>
      )}
    </section>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="row">
      <span className="k">
        {ok ? "✓" : "○"} {label}
      </span>
      <span>{detail}</span>
    </div>
  );
}
