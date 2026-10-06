import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { CreateEventDto, UpdateEventDto } from "./afisha.dto.js";
import { AfishaService } from "./afisha.service.js";

/** Афиша сети. Смотреть может любой сотрудник, заводить — владелец и управляющие. */
@Controller("network/events")
export class AfishaController {
  constructor(private readonly afisha: AfishaService) {}

  @Get()
  list(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.afisha.list(staff);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post()
  create(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: CreateEventDto) {
    return this.afisha.create(staff, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch(":eventId")
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("eventId") eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.afisha.update(staff, eventId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Delete(":eventId")
  async remove(@CurrentStaff() staff: AuthenticatedStaff, @Param("eventId") eventId: string) {
    await this.afisha.remove(staff, eventId);
    return { ok: true };
  }
}
