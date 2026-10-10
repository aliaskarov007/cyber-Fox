import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { CreatePromoDto, RedeemPromoDto } from "./promos.dto.js";
import { PromosService } from "./promos.service.js";

/**
 * Промокоды зала. Список и ввод кода за гостя доступны любому сотруднику —
 * код называют на стойке; заводить и отключать — владелец или управляющий:
 * промокод раздаёт деньги клуба.
 */
@Controller("clubs/:clubId")
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  @Get("promos")
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.promos.list(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("promos")
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreatePromoDto,
  ) {
    return this.promos.create(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("promos/:promoId/disable")
  disable(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("promoId") promoId: string,
  ) {
    return this.promos.disable(staff, clubId, promoId);
  }

  @Get("promos/:promoId/redemptions")
  redemptions(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("promoId") promoId: string,
  ) {
    return this.promos.redemptions(staff, clubId, promoId);
  }

  @Post("guests/:guestId/promo")
  redeem(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
    @Body() dto: RedeemPromoDto,
  ) {
    return this.promos.redeemAtDesk(staff, clubId, guestId, dto.code);
  }
}
