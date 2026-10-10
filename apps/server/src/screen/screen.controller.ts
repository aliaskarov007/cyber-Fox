import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { CreateSlideDto, UpdateSlideDto } from "./screen.dto.js";
import { ScreenService } from "./screen.service.js";

/** Слайды карусели на экране блокировки. Меняют владелец и управляющий. */
@Controller("clubs/:clubId/slides")
export class ScreenController {
  constructor(private readonly screen: ScreenService) {}

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Get()
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.screen.list(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateSlideDto,
  ) {
    return this.screen.create(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch(":slideId")
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("slideId") slideId: string,
    @Body() dto: UpdateSlideDto,
  ) {
    return this.screen.update(staff, clubId, slideId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Delete(":slideId")
  remove(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("slideId") slideId: string,
  ) {
    return this.screen.remove(staff, clubId, slideId);
  }
}
