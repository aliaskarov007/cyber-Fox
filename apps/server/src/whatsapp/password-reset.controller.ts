import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, Matches, MinLength } from "class-validator";

import { Public } from "../auth/guards.js";
import {
  PasswordResetService,
  type ResetConfirmResult,
} from "./password-reset.service.js";

class ResetRequestDto {
  @IsEmail()
  email!: string;
}

class ResetConfirmDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\s*\d{6}\s*$/, { message: "Код — шесть цифр" })
  code!: string;

  @IsString()
  @MinLength(8, { message: "Пароль от восьми символов" })
  password!: string;
}

/** «Забыли пароль?» на экране входа: код приходит в WhatsApp сотрудника. */
@Controller("auth/password-reset")
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @SkipThrottle({ general: true })
  @Throttle({ login: { ttl: 60_000, limit: 10 } })
  @Public()
  @HttpCode(200)
  @Post("request")
  request(@Body() dto: ResetRequestDto): Promise<{ sent: true }> {
    return this.reset.request(dto.email);
  }

  @SkipThrottle({ general: true })
  @Throttle({ login: { ttl: 60_000, limit: 20 } })
  @Public()
  @HttpCode(200)
  @Post("confirm")
  confirm(@Body() dto: ResetConfirmDto): Promise<ResetConfirmResult> {
    return this.reset.confirm(dto.email, dto.code, dto.password);
  }
}
