import { Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerException } from "@nestjs/throttler";

/**
 * Кого именно ограничиваем.
 *
 * По адресу в сети считать нельзя: весь клуб выходит в интернет через один
 * адрес, и пять попыток входа делятся на всех сотрудников сразу — один человек,
 * забывший пароль, запирает вход администратору, управляющему и владельцу.
 *
 * Поэтому на входе считаем по адресу почты: перебор чужого пароля упирается в
 * предел, а сосед по стойке от этого не страдает. Остальные запросы по-прежнему
 * считаются по адресу — там смысл другой, не дать одной машине завалить сервер.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const url = typeof req.originalUrl === "string" ? req.originalUrl : "";
    const isLogin = url.includes("/auth/login") || url.includes("/platform/login");

    if (isLogin) {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";
      if (email.length > 0) return `вход:${email}`;
    }

    return `адрес:${String(req.ip ?? "")}`;
  }

  /** Сообщение читает человек за стойкой, а не разработчик. */
  protected override async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException("Слишком много попыток. Подождите минуту и повторите.");
  }
}
