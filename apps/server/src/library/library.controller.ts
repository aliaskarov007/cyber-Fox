import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { CreateAppDto, UpdateAppDto } from "./library.dto.js";
import { LibraryService } from "./library.service.js";

/** Каталог игр клуба: то, что гость увидит на полках оболочки после оплаты. */
@Controller("clubs/:clubId/apps")
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.library.list(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateAppDto,
  ) {
    return this.library.create(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch(":appId")
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("appId") appId: string,
    @Body() dto: UpdateAppDto,
  ) {
    return this.library.update(staff, clubId, appId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Delete(":appId")
  remove(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("appId") appId: string,
  ) {
    return this.library.remove(staff, clubId, appId);
  }
}
