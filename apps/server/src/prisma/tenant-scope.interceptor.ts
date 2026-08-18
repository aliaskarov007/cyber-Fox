import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { Observable, from, switchMap } from "rxjs";

import { PrismaService } from "./prisma.service.js";
import { tenantStorage } from "./tenant-scope.js";

/**
 * Сообщает базе, чей запрос она обслуживает.
 *
 * Запрос сотрудника целиком идёт в одной транзакции, где выставлена настройка
 * app.tenant_id. Правила базы сверяются с ней и не отдают чужие строки — даже
 * если запрос попросил их напрямую, минуя проверки в коде.
 *
 * Запросы без сотрудника — вход, регистрация, проверка живости, вебхук
 * платежей — идут как раньше: сети у них ещё нет.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const tenantId = request.staff?.tenantId;
    if (!tenantId) return next.handle();

    const run = this.prisma.$transaction(
      async (tx) => {
        // set_config с третьим аргументом true действует до конца транзакции:
        // соединение вернётся в пул чистым, без чужой сети в настройках.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return tenantStorage.run({ tenantId, tx }, async () => {
          const result = next.handle();
          // Ответ обработчика ждём здесь же: транзакция должна пережить всю
          // работу запроса, иначе настройка снимется раньше времени.
          return await lastValue(result);
        });
      },
      // Запрос кассы не длиннее нескольких секунд; запас нужен на первую
      // загрузку карты зала, где считаются остатки по всем машинам.
      { timeout: 20_000 },
    );

    return from(run).pipe(switchMap((value) => (value instanceof Observable ? value : from([value]))));
  }
}

/** Последнее значение потока — то, что обработчик вернул как ответ. */
async function lastValue(source: Observable<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let last: unknown;
    source.subscribe({
      next: (value) => (last = value),
      error: reject,
      complete: () => resolve(last),
    });
  });
}
