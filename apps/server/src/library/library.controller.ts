import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { AcceptSuggestionsDto, CreateAppDto, UpdateAppDto } from "./library.dto.js";
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

  /** Что агенты нашли на машинах и чего ещё нет на полках. */
  @Get("suggestions")
  suggestions(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.library.suggestions(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("suggestions/accept")
  accept(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: AcceptSuggestionsDto,
  ) {
    return this.library.accept(staff, clubId, dto.ids);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Delete("suggestions/:id")
  dismiss(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("id") id: string,
  ) {
    return this.library.dismiss(staff, clubId, id);
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
