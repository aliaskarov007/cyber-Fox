import { Body, Controller, Get, Param, Put, Query, Req } from "@nestjs/common";
import { StaffRole } from "@prisma/client";
import { SkipThrottle } from "@nestjs/throttler";
import { IsBoolean } from "class-validator";
import type { Request } from "express";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Public, Roles } from "../auth/guards.js";
import { KaspiProviderService } from "./kaspi-provider.service.js";

class SaveKaspiProviderDto {
  @IsBoolean()
  enabled!: boolean;
}

/**
 * Kaspi.kz напрямую, по протоколу провайдера: «Платежи» в приложении Kaspi →
 * номер телефона гостя → деньги на его счёт. Адрес с токеном сети отдаётся
 * Kaspi при подключении; без токена и не с адресов Kaspi запрос не проходит.
 */
@Controller()
export class KaspiProviderController {
  constructor(private readonly kaspi: KaspiProviderService) {}

  @Roles(StaffRole.OWNER)
  @Get("network/kaspi-provider")
  get(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.kaspi.get(staff);
  }

  @Roles(StaffRole.OWNER)
  @Put("network/kaspi-provider")
  save(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: SaveKaspiProviderDto) {
    return this.kaspi.save(staff, dto.enabled);
  }

  /**
   * Запросы Kaspi: ?command=check|pay&txn_id=…&account=…&sum=…&txn_date=…
   * Kaspi ждёт ответа 15 секунд и может слать до 15 запросов разом —
   * общий ограничитель частоты здесь не нужен.
   */
  @Public()
  @SkipThrottle({ general: true, login: true })
  @Get("payments/kaspi/:token")
  handle(@Param("token") token: string, @Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.kaspi.handle(token, request.ip, query);
  }
}
