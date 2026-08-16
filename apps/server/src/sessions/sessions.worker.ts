import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { SessionsService } from "./sessions.service.js";

/**
 * Опрос вместо таймеров на сессию: раз в несколько секунд забираем сессии,
 * у которых подошёл срок списания. Опоздание на пару секунд ничего не стоит,
 * а состояние переживает перезапуск процесса.
 */
@Injectable()
export class SessionsWorker {
  private readonly logger = new Logger(SessionsWorker.name);
  private running = false;

  constructor(private readonly sessions: SessionsService) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    // Проход может затянуться на большой сети; второй одновременный запуск
    // списал бы те же минуты повторно.
    if (this.running) return;
    this.running = true;
    try {
      const processed = await this.sessions.chargeDueSessions();
      if (processed > 0) {
        this.logger.debug(`Списано минут: ${processed}`);
      }
    } catch (error) {
      this.logger.error("Ошибка прохода списания", error as Error);
    } finally {
      this.running = false;
    }
  }
}
