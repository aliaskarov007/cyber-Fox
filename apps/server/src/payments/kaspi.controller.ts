import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Put, Post, Req } from "@nestjs/common";
import { StaffRole } from "@prisma/client";
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Request } from "express";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Public, Roles } from "../auth/guards.js";
import { KaspiService } from "./kaspi.service.js";

class SaveKaspiDto {
  /** Пусто при повторном сохранении — оставить прежний ключ. */
  @IsOptional()
  @IsString()
  @MinLength(10, { message: "Ключ API ApiPay слишком короткий" })
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: "Секрет уведомлений слишком короткий" })
  @MaxLength(500)
  webhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Kaspi Pay через ApiPay. Настраивает владелец сети: деньги приходят на
 * Kaspi Pay сети. Уведомления ApiPay — единственная открытая без токена
 * точка; защита держится на подписи секретом сети.
 */
@Controller()
export class KaspiController {
  constructor(private readonly kaspi: KaspiService) {}

  @Roles(StaffRole.OWNER)
  @Get("network/kaspi")
  get(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.kaspi.get(staff);
  }

  @Roles(StaffRole.OWNER)
  @Put("network/kaspi")
  save(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: SaveKaspiDto) {
    return this.kaspi.save(staff, dto);
  }

  @Roles(StaffRole.OWNER)
  @Delete("network/kaspi")
  disconnect(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.kaspi.disconnect(staff);
  }

  /**
   * Уведомление ApiPay. Отвечаем быстро: ApiPay ждёт ответа пять секунд, а
   * зачисление — одна короткая транзакция. Подпись считается по сырому телу.
   */
  @Public()
  @Post("payments/apipay/:token")
  @HttpCode(200)
  webhook(
    @Param("token") token: string,
    @Req() request: Request & { rawBody?: Buffer },
    @Headers("x-webhook-signature") signature: string | undefined,
  ) {
    return this.kaspi.handleWebhook(token, request.rawBody?.toString("utf8") ?? "", signature);
  }
}
