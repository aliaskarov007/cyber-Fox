import { useCallback, useEffect, useState } from "react";

import {
  type Club,
  type TournamentSummary,
  type TournamentTeam,
  api,
  formatMoney,
} from "./api.js";

const TEAM_STATUS: Record<TournamentTeam["status"], { label: string; chip: string }> = {
  GATHERING: { label: "собирается", chip: "credit" },
  READY: { label: "в сборе", chip: "in-use" },
  DISBANDED: { label: "распущена", chip: "offline" },
};

const TOURNAMENT_STATUS: Record<string, string> = {
  REGISTRATION: "идёт запись",
  CLOSED: "запись закрыта",
  CANCELED: "отменён",
};

/** Сколько осталось до конца сбора — админу это нужнее точного времени. */
function timeLeft(deadline: string): string {
  const minutes = Math.round((new Date(deadline).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "срок вышел";
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/**
 * Турнир глазами администратора.
 *
 * Главное здесь — два списка рядом: неполные команды и свободные игроки.
 * Перед стартом их сводят вручную, потому что админ знает, кто с кем играет,
 * а подбор по алгоритму этого не знает.
 */
export function TournamentPanel({
  club,
  tournamentId,
  canManage,
  onChanged,
}: {
  club: Club;
  tournamentId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<TournamentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [winners, setWinners] = useState<string[]>([]);

  const load = useCallback(async () => {
    setData(await api.tournament(club.id, tournamentId));
  }, [club.id, tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Гости записываются сами, из WhatsApp: состав меняется, пока админ смотрит.
  useEffect(() => {
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
      await load();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="notice">Загружаем состав…</div>;

  const { tournament, teams, freeAgents } = data;
  const incomplete = teams.filter((t) => t.status === "GATHERING");
  const ready = teams.filter((t) => t.status === "READY");
  const open = tournament.status === "REGISTRATION";

  return (
    <section className="zone-block">
      <div className="zone-head">
        <h2>Состав турнира</h2>
        <span className={`chip ${open ? "in-use" : "idle"}`}>
          {TOURNAMENT_STATUS[tournament.status] ?? tournament.status}
        </span>
        <span className="count">
          {tournament.teamSize === 1 ? "одиночки" : `${tournament.teamSize}×${tournament.teamSize}`}
        </span>
      </div>

      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <div className="summary">
        <div className="stat">
          <div className="value">{data.slotsLeft}</div>
          <div className="label">Свободных мест из {tournament.slots}</div>
        </div>
        <div className="stat">
          <div className="value">{ready.length}</div>
          <div className="label">Команд в сборе</div>
        </div>
        <div className={`stat ${incomplete.length > 0 ? "alert" : ""}`}>
          <div className="value">{incomplete.length}</div>
          <div className="label">Ещё собираются</div>
        </div>
        <div className="stat">
          <div className="value">{formatMoney(data.prizePool)}</div>
          <div className="label">
            Призовой фонд
            {tournament.clubBonus > 0 && ` · от клуба ${formatMoney(tournament.clubBonus)}`}
          </div>
        </div>
      </div>

      {data.prizeBreakdown.length > 0 && (
        <div className="notice">
          Призы по местам:{" "}
          {data.prizeBreakdown.map((amount, index) => (
            <span key={index}>
              {index > 0 && " · "}
              {index + 1} место — {formatMoney(amount)}
            </span>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Команда</th>
              <th>Код</th>
              <th>Состав</th>
              <th>Состояние</th>
              {canManage && open && <th>Срок сбора</th>}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td>{team.name ?? "без названия"}</td>
                <td className="num">{team.code}</td>
                <td>
                  {team.members.map((m) => (
                    <span key={m.entryId}>
                      {m.isCaptain ? "★ " : ""}
                      {m.fullName}
                      {m !== team.members[team.members.length - 1] ? ", " : ""}
                    </span>
                  ))}
                  <span className="count">
                    {" "}
                    {team.members.length}/{tournament.teamSize}
                  </span>
                </td>
                <td>
                  <span className={`chip ${TEAM_STATUS[team.status].chip}`}>
                    {TEAM_STATUS[team.status].label}
                  </span>
                </td>
                {canManage && open && (
                  <td className="num">
                    {team.status === "GATHERING" ? timeLeft(team.gatherDeadline) : "—"}
                  </td>
                )}
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)" }}>
                  Пока никто не записался
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {freeAgents.length > 0 && (
        <>
          <div className="zone-head" style={{ marginTop: 18 }}>
            <h2>Свободные игроки</h2>
            <span className="count">{freeAgents.length}</span>
          </div>
          <div className="notice">
            Записались одни и ждут состав. Взнос с них уже взят — кто останется без команды,
            получит возврат при закрытии записи.
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {freeAgents.map((agent) => (
                  <tr key={agent.entryId}>
                    <td>{agent.fullName}</td>
                    <td className="num">{agent.phone}</td>
                    <td>
                      {canManage && open && incomplete.length > 0 ? (
                        <div className="actions">
                          <select
                            disabled={busy}
                            defaultValue=""
                            onChange={(e) => {
                              const teamId = e.target.value;
                              if (!teamId) return;
                              void act(async () => {
                                await api.assignFreeAgent(
                                  club.id,
                                  tournamentId,
                                  agent.entryId,
                                  teamId,
                                );
                                return `${agent.fullName} — в команду`;
                              });
                            }}
                          >
                            <option value="">Добрать в команду…</option>
                            {incomplete.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name ?? team.code} · {team.members.length}/
                                {tournament.teamSize}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>ждёт команду</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canManage && open && (
        <div className="actions" style={{ marginTop: 14 }}>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const loss = incomplete.length + freeAgents.length;
              if (
                loss > 0 &&
                !window.confirm(
                  `Закрыть запись? Несобравшиеся команды и игроки без состава получат возврат — всего записей: ${loss}.`,
                )
              ) {
                return;
              }
              void act(async () => {
                const result = await api.closeTournament(club.id, tournamentId);
                return `Запись закрыта. Распущено команд: ${result.disbanded}, возвратов: ${result.refunded}.`;
              });
            }}
          >
            Закрыть запись
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Отменить турнир? Взносы вернутся всем, кто записался.")) return;
              void act(async () => {
                const result = await api.cancelTournament(club.id, tournamentId);
                return `Турнир отменён, возвратов: ${result.refunded}.`;
              });
            }}
          >
            Отменить турнир
          </button>
        </div>
      )}

      {canManage && !open && tournament.status === "CLOSED" && ready.length > 0 && (
        <>
          <div className="zone-head" style={{ marginTop: 18 }}>
            <h2>Призы</h2>
          </div>
          <div className="notice">
            Назовите победителей по местам — фонд разойдётся на счета участников и попадёт в кассу
            смены.
          </div>
          <div className="settings-grid">
            {data.prizeBreakdown.map((amount, place) => (
              <label key={place}>
                {place + 1} место · {formatMoney(amount)}
                <select
                  value={winners[place] ?? ""}
                  onChange={(e) => {
                    const next = [...winners];
                    next[place] = e.target.value;
                    setWinners(next);
                  }}
                >
                  <option value="">—</option>
                  {ready.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name ?? team.code}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={busy || !winners[0]}
              onClick={() => {
                // Хвост пустых мест отбрасываем: приз за место без команды не уходит никуда.
                const chosen = winners.filter((id) => id);
                if (!window.confirm(`Выплатить призы? Команд-победителей: ${chosen.length}.`)) return;
                void act(async () => {
                  const result = await api.payTournamentPrizes(club.id, tournamentId, chosen);
                  return `Выплачено ${formatMoney(result.total)} — участников: ${result.paid}.`;
                });
              }}
            >
              Выплатить призы
            </button>
          </div>
        </>
      )}
    </section>
  );
}
