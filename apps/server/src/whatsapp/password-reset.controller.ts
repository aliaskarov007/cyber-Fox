import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { IsString, Matches, MinLength } from "class-validator";

import { Public } from "../auth/guards.js";
import {
  PasswordResetService,
  type ResetConfirmResult,
} from "./password-reset.service.js";

class ResetRequestDto {
  @IsString()
  @MinLength(10, { message: "Введите номер WhatsApp" })
  phone!: string;
}

class ResetConfirmDto {
  @IsString()
  @MinLength(10, { message: "Введите номер WhatsApp" })
  phone!: string;

  @IsString()
  @Matches(/^\s*\d{6}\s*$/, { message: "Код — шесть цифр" })
  code!: string;

  @IsString()
  @MinLength(8, { message: "Пароль от восьми символов" })
  password!: string;
}

/** «Забыли пароль?» на экране входа: сотрудник вводит свой номер, код приходит в WhatsApp. */
@Controller("auth/password-reset")
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @SkipThrottle({ general: true })
  @Throttle({ login: { ttl: 60_000, limit: 10 } })
  @Public()
  @HttpCode(200)
  @Post("request")
  request(@Body() dto: ResetRequestDto): Promise<{ sent: true }> {
    return this.reset.request(dto.phone);
  }

  @SkipThrottle({ general: true })
  @Throttle({ login: { ttl: 60_000, limit: 20 } })
  @Public()
  @HttpCode(200)
  @Post("confirm")
  confirm(@Body() dto: ResetConfirmDto): Promise<ResetConfirmResult> {
    return this.reset.confirm(dto.phone, dto.code, dto.password);
  }
}
