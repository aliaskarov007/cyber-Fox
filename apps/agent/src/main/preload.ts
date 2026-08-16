import { contextBridge, ipcRenderer } from "electron";

import type { AgentSettings } from "../shared/settings.js";

/**
 * Мост между экраном блокировки и системой. Наружу отдаём только то, что нужно
 * экрану: настройки подключения, их сохранение и две команды блокировки.
 */
contextBridge.exposeInMainWorld("cyberfox", {
  config: (): Promise<{
    serverUrl: string;
    pairingToken: string;
    hostname: string;
    configured: boolean;
  }> => ipcRenderer.invoke("agent:config"),
  saveConfig: (settings: AgentSettings): Promise<void> =>
    ipcRenderer.invoke("agent:save-config", settings),
  unlock: (): Promise<void> => ipcRenderer.invoke("agent:unlock"),
  lock: (): Promise<void> => ipcRenderer.invoke("agent:lock"),
});
