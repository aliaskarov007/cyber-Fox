import { useState } from "react";

import {
  type AgentSettings,
  normalizePairingToken,
  normalizeServerUrl,
  validate,
} from "../shared/settings.js";

/**
 * Первый запуск агента на игровой машине.
 *
 * Экран видит администратор при установке, а не гость: адрес сервера и код
 * привязки вводятся один раз, дальше машина узнаёт себя сама. Код берётся из
 * админки, экран «Подключение» — там он напечатан рядом с названием ПК.
 */
export function SetupScreen({
  initial,
  hostname,
  error,
  onSave,
}: {
  initial: AgentSettings;
  hostname: string;
  /** Причина отказа от сервера — например, неверный код привязки. */
  error: string | null;
  onSave: (settings: AgentSettings) => void;
}) {
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [pairingToken, setPairingToken] = useState(initial.pairingToken);
  const [problem, setProblem] = useState<string | null>(null);

  /** Правка поля снимает жалобу: висящая ошибка спорит с тем, что уже введено. */
  function edit(set: (value: string) => void): (value: string) => void {
    return (value) => {
      setProblem(null);
      set(value);
    };
  }

  function submit(): void {
    const settings: AgentSettings = {
      serverUrl: normalizeServerUrl(serverUrl),
      pairingToken: normalizePairingToken(pairingToken),
    };
    const complaint = validate(settings);
    if (complaint) {
      setProblem(complaint);
      return;
    }
    setProblem(null);
    onSave(settings);
  }

  return (
    <div className="setup">
      <h1>Настройка машины</h1>
      <p className="hint">
        Эту машину Windows называет <b>{hostname}</b>. Код привязки напечатан в админке, на экране
        «Подключение», рядом с названием ПК. Каждый код подходит только к одной машине.
      </p>

      {(problem ?? error) && <div className="banner warn">{problem ?? error}</div>}

      <label>
        Адрес сервера
        <input
          value={serverUrl}
          onChange={(e) => edit(setServerUrl)(e.target.value)}
          placeholder="club.cyberfox.kz"
          spellCheck={false}
          autoFocus
        />
      </label>

      <label>
        Код привязки
        <input
          value={pairingToken}
          onChange={(e) => edit(setPairingToken)(e.target.value)}
          placeholder="например, 4f3a9c…"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </label>

      <button className="primary" onClick={submit}>
        Сохранить и подключиться
      </button>
    </div>
  );
}
