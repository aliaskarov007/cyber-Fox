import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { type Period, ReportsService } from "./reports.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Период отчёта. По умолчанию — последние сутки: смена уже закрыта, данные полные. */
function parsePeriod(from?: string, to?: string): Period {
  const parsedTo = to ? new Date(to) : new Date();
  const parsedFrom = from ? new Date(from) : new Date(parsedTo.getTime() - DAY_MS);

  if (Number.isNaN(parsedFrom.getTime()) || Number.isNaN(parsedTo.getTime())) {
    throw new BadRequestException("Неверные даты периода");
  }
  if (parsedFrom > parsedTo) {
    throw new BadRequestException("Начало периода позже конца");
  }

  return { from: parsedFrom, to: parsedTo };
}

@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("network")
  network(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reports.network(staff, parsePeriod(from, to));
  }

  @Get("settlement")
  settlement(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reports.settlement(staff, parsePeriod(from, to));
  }

  @Get("clubs/:clubId/computers")
  computers(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reports.computers(staff, clubId, parsePeriod(from, to));
  }

  @Get("clubs/:clubId/hours")
  hours(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reports.hours(staff, clubId, parsePeriod(from, to));
  }
}
