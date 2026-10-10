import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { DEFAULT_OPTIONS } from "./retention.rules.js";
import { CreateWinbackDto, RetentionQueryDto } from "./retention.dto.js";
import { RetentionService } from "./retention.service.js";

/**
 * Отток гостей и их возврат. Владелец или управляющий: отчёт — это список
 * номеров с тратами, а рассылка раздаёт деньги клуба.
 */
@Roles(StaffRole.OWNER, StaffRole.ADMIN)
@Controller("clubs/:clubId/retention")
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  report(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query() query: RetentionQueryDto,
  ) {
    return this.retention.report(staff, clubId, {
      lostAfterDays: query.days ?? DEFAULT_OPTIONS.lostAfterDays,
      minVisits: query.minVisits ?? DEFAULT_OPTIONS.minVisits,
    });
  }

  @Get("campaigns")
  campaigns(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.retention.campaigns(staff, clubId);
  }

  @Post("campaigns")
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateWinbackDto,
  ) {
    return this.retention.createCampaign(staff, clubId, dto);
  }
}
