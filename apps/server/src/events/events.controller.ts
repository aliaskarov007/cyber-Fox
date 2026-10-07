import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { EventAudience, StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { AudienceQueryDto, CreateEventDto } from "./events.dto.js";
import { EventsService } from "./events.service.js";

/**
 * Ивенты зала. Смотреть может любой сотрудник — на стойке нужен список
 * записавшихся; заводить и рассылать — владелец или управляющий: рассылка
 * пишет всей сети от имени клуба.
 */
@Controller("clubs/:clubId/events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.events.list(staff, clubId);
  }

  @Get("audience")
  audience(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query() query: AudienceQueryDto,
  ) {
    return this.events.audienceSize(staff, clubId, query.audience ?? EventAudience.NETWORK);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.events.create(staff, clubId, dto);
  }

  @Get(":eventId/invites")
  invites(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("eventId") eventId: string,
  ) {
    return this.events.invites(staff, clubId, eventId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post(":eventId/send")
  send(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("eventId") eventId: string,
  ) {
    return this.events.send(staff, clubId, eventId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post(":eventId/cancel")
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("eventId") eventId: string,
  ) {
    return this.events.cancel(staff, clubId, eventId);
  }
}
