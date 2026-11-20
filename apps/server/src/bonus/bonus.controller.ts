import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";
import { IsInt, Min } from "class-validator";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { BonusService } from "./bonus.service.js";

class CreateBonusTierDto {
  /** Порог пополнения в тиын. */
  @IsInt()
  @Min(1)
  minTopUp!: number;

  /** Начисляемый бонус в тиын. */
  @IsInt()
  @Min(1)
  bonus!: number;
}

// Пороги бонуса за пополнение настраивает владелец или управляющий.
@Roles(StaffRole.OWNER, StaffRole.ADMIN)
@Controller("clubs/:clubId/bonus-tiers")
export class BonusController {
  constructor(private readonly bonus: BonusService) {}

  @Get()
  list(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
  ) {
    return this.bonus.list(staff, clubId);
  }

  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateBonusTierDto,
  ) {
    return this.bonus.create(staff, clubId, dto.minTopUp, dto.bonus);
  }

  @Delete(":id")
  remove(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("id") id: string,
  ) {
    return this.bonus.remove(staff, clubId, id);
  }
}
