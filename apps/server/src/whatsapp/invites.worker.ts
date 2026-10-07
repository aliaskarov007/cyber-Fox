import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { InvitesService } from "./invites.service.js";

/**
 * Очередь рассылки. Опрос, а не таймеры: перезапуск сервера посреди
 * рассылки ничего не теряет — неотправленное уходит на следующем проходе.
 */
@Injectable()
export class InvitesWorker {
  private readonly logger = new Logger(InvitesWorker.name);
  private running = false;

  constructor(private readonly invites: InvitesService) {}

  @Interval(10_000)
  async tick(): Promise<void> {
    // Проход с паузами длится дольше интервала; второй одновременный
    // отправил бы гостю то же приглашение дважды.
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.invites.processQueue();
      if (sent > 0) this.logger.debug(`Отправлено приглашений: ${sent}`);
    } catch (error) {
      this.logger.error("Ошибка прохода рассылки", error as Error);
    } finally {
      this.running = false;
    }
  }
}
