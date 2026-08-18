import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

import { PrismaService } from "../prisma/prisma.service.js";
import { Public } from "../auth/guards.js";

/**
 * Живость сервера для докера и внешнего наблюдателя.
 *
 * Проверяется не «процесс запущен», а «база отвечает»: подвисший на базе сервер
 * отвечает на порт, но не может ни начать сессию, ни списать минуты, и для зала
 * это то же самое, что упавший.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(): Promise<{ ok: true; uptime: number }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // Причину наружу не выносим: точка открыта без пароля.
      throw new ServiceUnavailableException("База недоступна");
    }
    return { ok: true, uptime: Math.round(process.uptime()) };
  }
}
