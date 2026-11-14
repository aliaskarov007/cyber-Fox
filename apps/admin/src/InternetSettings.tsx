import { type FormEvent, useEffect, useState } from "react";

import { type Club, type ClubInternet, api } from "./api.js";

/**
 * Интернет-каналы клуба: подключение к роутеру (MikroTik) и список провайдеров.
 * Гость на игровом ПК сможет выбрать, через какой канал играть. Тип подключения
 * (статика/динамика, PPPoE/DHCP) настраивается на самом роутере — здесь только
 * его адрес, доступ к API и понятные названия каналов.
 *
 * Пароль роутера после сохранения не показывается.
 */
export function InternetSettings({
  club,
  onSaved,
}: {
  club: Club;
  onSaved: (message: string) => void;
}) {
  const [data, setData] = useState<ClubInternet | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [driver, setDriver] = useState<"ROS7" | "ROS6">("ROS7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Поля нового канала.
  const [chName, setChName] = useState("");
  const [chMark, setChMark] = useState("");

  function apply(next: ClubInternet): void {
    setData(next);
    setHost(next.router.host ?? "");
    setPort(next.router.apiPort ? String(next.router.apiPort) : "");
    setUser(next.router.username ?? "");
    setDriver(next.router.driver === "ROS6" ? "ROS6" : "ROS7");
    setPass("");
  }

  useEffect(() => {
    void api
      .internet(club.id)
      .then(apply)
      .catch(() => setData(null));
  }, [club.id]);

  async function run(
    action: () => Promise<ClubInternet>,
    message: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
      onSaved(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRouter(event: FormEvent): Promise<void> {
    event.preventDefault();
    await run(
      () =>
        api.saveInternetRouter(club.id, {
          host: host.trim(),
          apiPort: port.trim() ? Number(port) : 0,
          username: user.trim(),
          ...(pass.trim() ? { password: pass.trim() } : {}),
          driver,
        }),
      "Роутер сохранён",
    );
  }

  const router = data?.router;
  const channels = data?.channels ?? [];
  const canAdd = channels.length < 2;

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Интернет-каналы «{club.name}»</h2>
        {router?.configured && (
          <span className={`chip ${router.enabled ? "in-use" : "offline"}`}>
            {router.enabled ? "роутер подключён" : "роутер выключен"}
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}

      <p className="hint">
        Позволяет гостю на игровом ПК выбрать, через какого провайдера играть —
        удобно, когда у одного ниже пинг до одних серверов, у другого до других.
        Нужен роутер MikroTik с настроенными двумя каналами. Тип подключения
        каждого провайдера (статический или динамический IP, PPPoE или DHCP)
        настраивается на самом роутере — программе он не важен.
      </p>

      <form className="settings-grid" onSubmit={saveRouter}>
        <label>
          Адрес роутера в сети клуба
          <input
            value={host}
            placeholder="192.168.0.1"
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label>
          Порт API (пусто — по умолчанию)
          <input
            value={port}
            placeholder={driver === "ROS7" ? "443" : "8728"}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <label>
          Пользователь API
          <input
            value={user}
            autoComplete="off"
            placeholder="cyberfox"
            onChange={(e) => setUser(e.target.value)}
          />
        </label>
        <label>
          Пароль API
          <input
            type="password"
            autoComplete="off"
            value={pass}
            placeholder={router?.configured ? "сохранён — оставьте пустым" : ""}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label>
          Тип роутера
          <select
            value={driver}
            onChange={(e) => setDriver(e.target.value as "ROS7" | "ROS6")}
          >
            <option value="ROS7">RouterOS 7 (REST API)</option>
            <option value="ROS6">RouterOS 6 (API)</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {router?.configured ? "Сохранить роутер" : "Подключить роутер"}
        </button>
      </form>

      {router?.configured && (
        <div className="actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  api.saveInternetRouter(club.id, { enabled: !router.enabled }),
                router.enabled ? "Роутер выключен" : "Роутер включён",
              )
            }
          >
            {router.enabled ? "Выключить" : "Включить"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Удалить настройки роутера для этого клуба?"))
                return;
              void run(
                () => api.deleteInternetRouter(club.id),
                "Роутер удалён",
              );
            }}
          >
            Удалить роутер
          </button>
          <label className="switch-inline">
            <input
              type="checkbox"
              checked={router.allowMidSession}
              disabled={busy}
              onChange={(e) =>
                void run(
                  () =>
                    api.saveInternetRouter(club.id, {
                      allowMidSession: e.target.checked,
                    }),
                  e.target.checked
                    ? "Смена канала в середине сессии разрешена"
                    : "Канал можно выбрать только в начале сессии",
                )
              }
            />
            Разрешать менять канал в середине сессии
          </label>
        </div>
      )}

      <div className="section">
        <h3>Каналы (провайдеры)</h3>
        {channels.length === 0 && (
          <p className="hint">
            Пока нет каналов. Добавьте те, что настроены на роутере — по одному
            на каждого провайдера (максимум два).
          </p>
        )}
        <div className="channel-list">
          {channels.map((ch) => (
            <div className="channel-row" key={ch.id}>
              <span className="channel-name">{ch.name}</span>
              <span className="channel-mark">{ch.routerMark}</span>
              <label className="switch-inline">
                <input
                  type="radio"
                  name={`default-${club.id}`}
                  checked={ch.isDefault}
                  disabled={busy || ch.isDefault}
                  onChange={() =>
                    void run(
                      () =>
                        api.updateInternetChannel(club.id, ch.id, {
                          isDefault: true,
                        }),
                      `«${ch.name}» теперь канал по умолчанию`,
                    )
                  }
                />
                по умолчанию
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Удалить канал «${ch.name}»?`)) return;
                  void run(
                    () => api.deleteInternetChannel(club.id, ch.id),
                    "Канал удалён",
                  );
                }}
              >
                Удалить
              </button>
            </div>
          ))}
        </div>

        {canAdd && (
          <form
            className="settings-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (!chName.trim() || !chMark.trim()) return;
              void run(
                () =>
                  api.addInternetChannel(club.id, {
                    name: chName.trim(),
                    routerMark: chMark.trim(),
                  }),
                "Канал добавлен",
              ).then(() => {
                setChName("");
                setChMark("");
              });
            }}
          >
            <label>
              Название для гостя
              <input
                value={chName}
                placeholder="Казахтелеком"
                onChange={(e) => setChName(e.target.value)}
              />
            </label>
            <label>
              Имя на роутере (address-list)
              <input
                value={chMark}
                placeholder="wan-kt"
                onChange={(e) => setChMark(e.target.value)}
              />
            </label>
            <button
              className="primary"
              type="submit"
              disabled={busy || !chName.trim() || !chMark.trim()}
            >
              Добавить канал
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
