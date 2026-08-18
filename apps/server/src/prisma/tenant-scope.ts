import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Сеть текущего запроса и транзакция, в которой он идёт.
 *
 * База отделяет сети сама, но для этого ей нужно знать, чей запрос она сейчас
 * обслуживает. Настройка живёт в транзакции, поэтому запрос и его транзакция
 * хранятся вместе: любой сервис, обратившийся к базе внутри запроса, попадёт в
 * ту же транзакцию и под то же ограничение.
 */
export interface TenantScope {
  tenantId: string;
  tx: Prisma.TransactionClient;
}

export const tenantStorage = new AsyncLocalStorage<TenantScope>();

/** Клиент текущего запроса: транзакция с настроенной сетью либо общий клиент. */
export function currentClient(base: PrismaClient): PrismaClient | Prisma.TransactionClient {
  return tenantStorage.getStore()?.tx ?? base;
}
