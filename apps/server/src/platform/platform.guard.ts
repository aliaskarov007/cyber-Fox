import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

import { PrismaService } from "../prisma/prisma.service.js";

/** Что лежит в токене платформы. Флаг обязателен: кассовый токен сюда не пустят. */
export interface PlatformPayload {
  sub: string;
  platform: true;
}

/**
 * Вход для тех, кто продаёт систему, а не работает в зале.
 *
 * Проверяется отдельно от сотрудников: токен кассы, даже владельческий, сюда не
 * подходит. Иначе достаточно было бы завести себе клуб, чтобы увидеть чужие.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { platformAdminId?: string }>();
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    const payload = await this.jwt.verifyAsync<PlatformPayload>(token).catch(() => null);
    if (!payload?.platform) throw new UnauthorizedException();

    // Отключённая учётная запись перестаёт работать сразу, а не по сроку токена.
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });
    if (!admin || !admin.isActive) throw new UnauthorizedException();

    request.platformAdminId = admin.id;
    return true;
  }
}
