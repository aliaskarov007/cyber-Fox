import { contextBridge, ipcRenderer } from "electron";

import type { AgentSettings } from "../shared/settings.js";

/**
 * Мост между экраном блокировки и системой. Наружу отдаём только то, что нужно
 * экрану: настройки подключения, их сохранение и две команды блокировки.
 */
contextBridge.exposeInMainWorld("cyberfox", {
  config: (): Promise<
    AgentSettings & { hostname: string; macAddress: string; configured: boolean }
  > => ipcRenderer.invoke("agent:config"),
  saveConfig: (settings: AgentSettings): Promise<void> =>
    ipcRenderer.invoke("agent:save-config", settings),
  unlock: (): Promise<void> => ipcRenderer.invoke("agent:unlock"),
  lock: (): Promise<void> => ipcRenderer.invoke("agent:lock"),
  /** Что за игры стоят на этой машине. */
  scan: (): Promise<Array<{ name: string; target: string; coverUrl: string }>> =>
    ipcRenderer.invoke("agent:scan"),
  /** Запуск игры с полки: программой на диске или ссылкой вроде steam://. */
  launch: (app: { kind: string; target: string; args: string[] }): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke("agent:launch", app),
});
