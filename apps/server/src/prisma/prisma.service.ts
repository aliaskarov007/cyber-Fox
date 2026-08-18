import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { currentClient, tenantStorage } from "./tenant-scope.js";

/**
 * Доступ к базе.
 *
 * Обращения к таблицам внутри запроса уходят в транзакцию этого запроса — ту,
 * где базе сообщили, чья это сеть. Сервисы про это не знают и не должны: иначе
 * изоляция держалась бы на том, что каждый разработчик вспомнил про неё в
 * каждом новом запросе, а это ровно та надёжность, от которой мы уходим.
 *
 * Вне запроса — фоновый счётчик минут, подключения игровых машин — работает
 * обычный клиент без ограничения: сети у этих путей нет.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();

    return new Proxy(this, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);

        // Служебное и методы самого клиента отдаём как есть: подменять $connect
        // или $transaction транзакцией запроса нельзя.
        if (typeof property !== "string" || property.startsWith("$") || property.startsWith("_")) {
          return typeof value === "function" ? value.bind(target) : value;
        }

        const scoped = tenantStorage.getStore();
        if (!scoped) return value;

        const model = (currentClient(target) as Record<string, unknown>)[property];
        return model ?? value;
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
