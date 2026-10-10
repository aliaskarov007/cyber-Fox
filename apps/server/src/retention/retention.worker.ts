import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { RetentionService } from "./retention.service.js";

/**
 * Очередь сообщений ушедшим гостям. Опрос, а не таймеры: перезапуск сервера
 * посреди рассылки ничего не теряет — неотправленное уйдёт следующим проходом.
 */
@Injectable()
export class RetentionWorker {
  private readonly logger = new Logger(RetentionWorker.name);
  private running = false;

  constructor(private readonly retention: RetentionService) {}

  @Interval(10_000)
  async tick(): Promise<void> {
    // Проход с паузами длится дольше интервала; второй одновременный написал
    // бы гостю дважды.
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.retention.processQueue();
      if (sent > 0) this.logger.debug(`Отправлено сообщений ушедшим гостям: ${sent}`);
    } catch (error) {
      this.logger.error("Ошибка прохода рассылки возврата", error as Error);
    } finally {
      this.running = false;
    }
  }
}
