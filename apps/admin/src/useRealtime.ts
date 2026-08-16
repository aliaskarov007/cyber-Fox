import { useEffect, useRef } from "react";
import { type Socket, io } from "socket.io-client";

import { getToken } from "./api.js";

/**
 * Живое обновление карты зала.
 *
 * События движка приходят по сокету, но полагаться только на них нельзя:
 * при разрыве соединения экран должен догнать состояние сам, поэтому
 * вызывающий по этому же сигналу перезапрашивает карту.
 */
export function useRealtime(onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket: Socket = io({ auth: { token }, transports: ["websocket"] });

    const refresh = (): void => handler.current();
    for (const event of [
      "session.started",
      "session.stopped",
      "session.tick",
      "session.switched",
      "computer.status",
    ]) {
      socket.on(event, refresh);
    }

    socket.on("staff.called", (event: { computerId: string }) => {
      // Вызов администратора — единственное событие, требующее внимания само по себе.
      console.info("Вызов администратора", event.computerId);
      handler.current();
    });

    return () => {
      socket.close();
    };
  }, []);
}
