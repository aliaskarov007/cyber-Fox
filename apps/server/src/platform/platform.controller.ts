import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";

import { Public } from "../auth/guards.js";
import { CreateTenantDto, PlatformLoginDto, UpdateSubscriptionDto } from "./platform.dto.js";
import { PlatformGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";

/**
 * Платформенная часть: обзор всех сетей и подключение новых клубов.
 *
 * Открыта только по своему входу. Кассовый токен, даже владельческий, сюда не
 * подходит — иначе достаточно было бы завести себе клуб, чтобы увидеть чужие.
 */
@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  // Считается по почте, как и вход в кассу; предел ниже: подбор пароля к
  // платформе опаснее. Из общего счётчика по адресу вход выведен.
  @SkipThrottle({ general: true })
  @Throttle({ login: { ttl: 60_000, limit: 10 } })
  @Public()
  @Post("login")
  login(@Body() dto: PlatformLoginDto) {
    return this.platform.login(dto.email, dto.password);
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Get("tenants")
  tenants() {
    return this.platform.tenants();
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Post("tenants")
  createTenant(@Body() dto: CreateTenantDto) {
    return this.platform.createTenant(dto);
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Patch("tenants/:tenantId/subscription")
  updateSubscription(@Param("tenantId") tenantId: string, @Body() dto: UpdateSubscriptionDto) {
    return this.platform.updateSubscription(tenantId, dto);
  }
}
