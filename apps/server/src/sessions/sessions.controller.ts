import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { MoveSessionDto, StartSessionDto } from "./sessions.dto.js";
import { SessionsService } from "./sessions.service.js";

@Controller("clubs/:clubId")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Карта зала: то, на что администратор смотрит всю смену. */
  @Get("hall")
  hall(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.sessions.hallMap(staff, clubId);
  }

  @Post("sessions")
  start(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: StartSessionDto,
  ) {
    return this.sessions.startByStaff(staff, clubId, dto);
  }

  @Post("sessions/:sessionId/stop")
  stop(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.sessions.stopByStaff(staff, clubId, sessionId);
  }

  @Post("sessions/:sessionId/pause")
  pause(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.sessions.pause(staff, clubId, sessionId);
  }

  @Post("sessions/:sessionId/resume")
  resume(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.sessions.resume(staff, clubId, sessionId);
  }

  @Post("sessions/:sessionId/move")
  move(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: MoveSessionDto,
  ) {
    return this.sessions.move(staff, clubId, sessionId, dto);
  }
}
