import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { AssignFreeAgentDto, CreateTournamentDto, PayPrizesDto } from "./tournaments.dto.js";
import { TournamentsService } from "./tournaments.service.js";

/**
 * Турниры зала. Состав смотрит любой сотрудник — он нужен на стойке перед
 * началом; заводить, закрывать запись и выплачивать призы может владелец или
 * управляющий: всё это трогает деньги гостей.
 */
@Controller("clubs/:clubId")
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("events/:eventId/tournament")
  attach(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("eventId") eventId: string,
    @Body() dto: CreateTournamentDto,
  ) {
    return this.tournaments.attach(staff, clubId, eventId, dto);
  }

  @Get("tournaments/:tournamentId")
  summary(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("tournamentId") tournamentId: string,
  ) {
    return this.tournaments.summary(staff, clubId, tournamentId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("tournaments/:tournamentId/free-agents")
  assign(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: AssignFreeAgentDto,
  ) {
    return this.tournaments.assignFreeAgent(staff, clubId, dto.entryId, dto.teamId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("tournaments/:tournamentId/close")
  close(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("tournamentId") tournamentId: string,
  ) {
    return this.tournaments.closeRegistration(staff, clubId, tournamentId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("tournaments/:tournamentId/cancel")
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("tournamentId") tournamentId: string,
  ) {
    return this.tournaments.cancel(staff, clubId, tournamentId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("tournaments/:tournamentId/prizes")
  prizes(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("tournamentId") tournamentId: string,
    @Body() dto: PayPrizesDto,
  ) {
    return this.tournaments.payPrizes(staff, clubId, tournamentId, dto.teamIds);
  }
}
