import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

/**
 * Шина событий между движком сессий и веб-сокетами.
 *
 * Нужна, чтобы разорвать цикл: сервис сессий публикует события, шлюз их
 * рассылает, а команды идут в обратную сторону напрямую. Без шины сервис и шлюз
 * ссылались бы друг на друга.
 */
export interface SessionEvent {
  clubId: string;
  computerId: string;
  sessionId: string;
}

export interface RealtimeEvents {
  "session.started": SessionEvent;
  "session.stopped": SessionEvent & { reason: string };
  "session.tick": SessionEvent & {
    packageMinutesLeft: number | null;
    balance: number;
    minutesAffordable: number | null;
    creditLeft: number | null;
    accruedCost: number;
    /* Панель гостя в оболочке. У анонимной посадки пусто: гостя нет. */
    guestName?: string | null;
    bonusPoints?: number | null;
    tariffName?: string | null;
  };
  "session.switched": SessionEvent & {
    to: "PACKAGE" | "PER_MINUTE";
    tariffId: string;
    pricePerMinute: number | null;
    minutesLeft: number | null;
  };
  "computer.status": { clubId: string; computerId: string; status: string };
  "staff.called": { clubId: string; computerId: string; sessionId: string | null };
  /*
   * Каталог игр клуба изменился. Машины забирают его заново сами: пересылать
   * список всем сорока при каждой правке дороже, чем сказать «обнови».
   */
  "library.changed": { clubId: string };
}

@Injectable()
export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Один шлюз на процесс, но слушателей может быть больше при отладке.
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof RealtimeEvents>(event: K, payload: RealtimeEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof RealtimeEvents>(
    event: K,
    listener: (payload: RealtimeEvents[K]) => void,
  ): void {
    this.emitter.on(event, listener as (payload: unknown) => void);
  }
}
