import { contextBridge, ipcRenderer } from "electron";

/**
 * Мост между экраном блокировки и системой. Наружу отдаём только то, что нужно
 * экрану: настройки подключения и две команды блокировки.
 */
contextBridge.exposeInMainWorld("cyberfox", {
  config: (): Promise<{ serverUrl: string; pairingToken: string; hostname: string }> =>
    ipcRenderer.invoke("agent:config"),
  unlock: (): Promise<void> => ipcRenderer.invoke("agent:unlock"),
  lock: (): Promise<void> => ipcRenderer.invoke("agent:lock"),
});
