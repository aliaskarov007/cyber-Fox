import { type Socket, io } from "socket.io-client";

import type { OfflineOperation } from "./offline-journal.js";

import type { AgentSettings } from "../shared/settings.js";

/** Настройки приходят из основного процесса: экран их не хранит. */
export interface AgentConfig extends AgentSettings {
  hostname: string;
  /** MAC сетевой карты: им машина называет себя в бездисковом зале. */
  macAddress: string;
  /** Машину уже настроили: есть адрес сервера и способ себя назвать. */
  configured: boolean;
}

export interface PairedInfo {
  computerId: string;
  computerName: string;
  zoneName: string;
  clubName: string;
}

export interface GuestLoginResult {
  ok: boolean;
  reason: string | null;
  guest: { id: string; fullName: string; balance: number } | null;
  packagesInZone: Array<{ id: string; minutesRemaining: number; expiresAt: string }>;
  packagesElsewhere: Array<{ id: string; zoneName: string; minutesRemaining: number }>;
  perMinutePrice: number | null;
  minutesAffordable: number | null;
}

export interface Tick {
  sessionId: string;
  packageMinutesLeft: number | null;
  balance: number;
  minutesAffordable: number | null;
  creditLeft: number | null;
  accruedCost: number;
}

declare global {
  interface Window {
    cyberfox: {
      config: () => Promise<AgentConfig>;
      saveConfig: (settings: AgentSettings) => Promise<void>;
      unlock: () => Promise<void>;
      lock: () => Promise<void>;
    };
  }
}

/**
 * Соединение агента с сервером.
 *
 * Сервер — единственный арбитр состояния: агент не решает сам, можно ли начать
 * сессию, он только передаёт запрос и показывает ответ.
 */
export class AgentClient {
  private socket: Socket | null = null;

  async connect(handlers: {
    onPaired: (info: PairedInfo) => void;
    onTick: (tick: Tick) => void;
    onStarted: () => void;
    onLock: () => void;
    onSwitched: (event: {
      to: "PACKAGE" | "PER_MINUTE";
      pricePerMinute: number | null;
      minutesLeft: number | null;
    }) => void;
    onConnectionChange: (online: boolean) => void;
    /** Сервер не принял машину — например, код привязки набран с ошибкой. */
    onRejected: (reason: string) => void;
  }): Promise<void> {
    const config = await window.cyberfox.config();

    this.socket = io(config.serverUrl, {
      auth: {
        // Ключ клуба и код привязки — два способа опознания. Сервер смотрит
        // сначала на ключ: если он есть, машина из бездискового зала.
        enrollmentKey: config.enrollmentKey || undefined,
        macAddress: config.macAddress,
        pairingToken: config.pairingToken || undefined,
        hostname: config.hostname,
      },
      transports: ["websocket"],
      reconnection: true,
    });

    this.socket.on("connect", () => handlers.onConnectionChange(true));
    this.socket.on("disconnect", () => handlers.onConnectionChange(false));
    /*
     * Отказ приходит до разрыва соединения. Без него агент молча переподключался
     * бы по кругу, а администратор смотрел бы на «подключаемся к серверу» и не
     * знал, что ошибся в коде.
     */
    this.socket.on("pair.rejected", (event: { reason: string }) =>
      handlers.onRejected(event.reason),
    );
    this.socket.on("paired", handlers.onPaired);
    this.socket.on("session.tick", handlers.onTick);
    this.socket.on("session.started", handlers.onStarted);
    this.socket.on("session.switched", handlers.onSwitched);
    this.socket.on("lock", handlers.onLock);

    // Сердцебиение: по нему админ видит, что машина на связи.
    setInterval(() => this.socket?.emit("heartbeat"), 30_000);
  }

  login(phone: string, pin: string): Promise<GuestLoginResult> {
    return this.request("guest.login", { phone, pin });
  }

  startSession(guestId: string, tariffId?: string): Promise<{ ok: boolean; reason?: string }> {
    return this.request("session.start", { guestId, tariffId });
  }

  stopSession(sessionId: string): Promise<{ ok: boolean; reason?: string }> {
    return this.request("session.stop", { sessionId });
  }

  callStaff(): Promise<{ ok: boolean }> {
    return this.request("staff.call", {});
  }

  /** Досылка минут, отыгранных без связи с облаком. */
  replayOffline(operations: OfflineOperation[]): Promise<{
    ok: boolean;
    applied?: number;
    duplicates?: number;
    rejected?: number;
    reason?: string;
  }> {
    return this.request("offline.replay", { operations });
  }

  private request<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Нет соединения с сервером"));
        return;
      }
      this.socket.timeout(10_000).emit(event, payload, (error: Error | null, response: T) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }
}

/** Тиын → тенге для экрана гостя. */
export function formatMoney(tiyn: number): string {
  return `${(tiyn / 100).toLocaleString("ru-KZ", { maximumFractionDigits: 0 })} ₸`;
}

/**
 * Остаток времени для крупной цифры на экране гостя.
 *
 * Часы и минуты подписываются словами: «10:12» под подписью «минут» гость
 * читает как двенадцать минут и идёт к администратору раньше времени.
 */
export function formatRemaining(minutes: number): { value: string; unit: string | null } {
  if (minutes < 60) return { value: String(minutes), unit: "минут" };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  // Единицы уже внутри значения — подпись их не повторяет.
  return { value: `${h} ч ${String(m).padStart(2, "0")} мин`, unit: null };
}
