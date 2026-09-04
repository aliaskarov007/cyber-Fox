import { Body, Controller, Get, Post } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MinLength } from "class-validator";

import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService, type LoginResult } from "./auth.service.js";
import type { AuthenticatedStaff } from "./auth.types.js";
import { CurrentStaff } from "./current-staff.decorator.js";
import { Public } from "./guards.js";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /*
   * Тридцать попыток в минуту на одну почту. Считается именно по почте: весь
   * клуб выходит в интернет через один адрес, и счёт по адресу запирал вход
   * всему залу, стоило одному человеку забыть пароль. По той же причине вход
   * выведен из общего счётчика по адресу: иначе сорок агентов и гости зала
   * выбирали его раньше, чем администратор успевал войти.
   */
  @SkipThrottle({ general: true })
  @Throttle({ login: { ttl: 60_000, limit: 30 } })
  @Public()
  @Post("login")
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.email, dto.password);
  }

  @Get("me")
  async me(@CurrentStaff() staff: AuthenticatedStaff) {
    const record = await this.prisma.staff.findUniqueOrThrow({
      where: { id: staff.id },
      select: {
        id: true,
        tenantId: true,
        clubId: true,
        email: true,
        fullName: true,
        role: true,
        tenant: { select: { name: true, sharedBalance: true } },
      },
    });
    return record;
  }
}
