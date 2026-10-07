import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { EventsService } from "./events.service.js";

/**
 * Очередь рассылки приглашений. Как и счётчик минут, это опрос, а не таймеры:
 * перезапуск сервера посреди рассылки ничего не теряет — неотправленные
 * приглашения остаются в очереди и уходят на следующем проходе.
 */
@Injectable()
export class EventsWorker {
  private readonly logger = new Logger(EventsWorker.name);
  private running = false;

  constructor(private readonly events: EventsService) {}

  @Interval(10_000)
  async tick(): Promise<void> {
    // Проход с паузами длится дольше интервала; второй одновременный
    // отправил бы гостю то же приглашение дважды.
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.events.processQueue();
      if (sent > 0) this.logger.debug(`Отправлено приглашений: ${sent}`);
    } catch (error) {
      this.logger.error("Ошибка прохода рассылки", error as Error);
    } finally {
      this.running = false;
    }
  }
}
