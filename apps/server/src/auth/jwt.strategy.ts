import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedStaff, JwtPayload } from "./auth.types.js";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_SECRET"),
    });
  }

  /**
   * Токен сверяется с сотрудником, а не принимается на слово.
   *
   * Раньше содержимое токена возвращалось как есть, и двенадцать часов после
   * увольнения человек продолжал работать в кассе: достаточно было не закрывать
   * вкладку. Теперь каждый запрос проверяет, что сотрудник ещё работает и что
   * его токены не отозваны — увольнение, смена пароля и смена роли поднимают
   * версию.
   *
   * Цена — один запрос к базе по первичному ключу на запрос к API. Для зала с
   * одним кассовым экраном это ничто, а разница между «уволен» и «всё ещё
   * внутри» стоит дороже.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedStaff> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: payload.sub },
      select: { id: true, tenantId: true, clubId: true, role: true, isActive: true, tokenVersion: true },
    });

    if (!staff || !staff.isActive || staff.tokenVersion !== payload.ver) {
      throw new UnauthorizedException("Сессия больше не действительна");
    }

    // Права берутся из базы, а не из токена: смена клуба или роли действует
    // сразу, не дожидаясь, пока сотрудник войдёт заново.
    return {
      id: staff.id,
      tenantId: staff.tenantId,
      clubId: staff.clubId,
      role: staff.role,
    };
  }
}
