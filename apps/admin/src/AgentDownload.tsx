/** Прямая ссылка на последний выпуск: одинаковая для всех версий. */
const INSTALLER_URL =
  "https://github.com/aliaskarov007/cyber-Fox/releases/latest/download/CyberFoxAgentSetup.exe";

/**
 * Откуда клуб берёт установщик агента.
 *
 * Ссылка ведёт на выпуск, а не на сборку: артефакты сборки требуют входа в
 * GitHub, а клуб туда не заходит и заходить не должен. Файл собирается на
 * настоящей Windows и подписывается контрольной суммой самим GitHub.
 */
export function AgentDownload() {
  return (
    <div className="notice">
      <b>Установщик агента</b>
      <div className="note" style={{ marginTop: 6 }}>
        Ставится на игровые машины: блокировка до оплаты и полки с играми после. В зале на
        бездисковой загрузке — один раз в образ, на машинах с дисками — на каждую.
      </div>

      <div className="actions" style={{ marginTop: 8 }}>
        <a className="button-link" href={INSTALLER_URL} target="_blank" rel="noreferrer">
          Скачать для Windows
        </a>
      </div>

      <div className="note" style={{ marginTop: 6 }}>
        {/* Предупреждение честнее, чем удивлённый звонок из зала. */}
        Windows покажет предупреждение SmartScreen: «Подробнее» → «Выполнить в любом случае».
        Установщик пока не подписан сертификатом.
      </div>
    </div>
  );
}
