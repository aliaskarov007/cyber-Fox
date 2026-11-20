import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import {
  CreateReservationDto,
  UpdateReservationStatusDto,
} from "./reservations.dto.js";
import { ReservationsService } from "./reservations.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

@Controller("clubs/:clubId/reservations")
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** Бронь на день (по умолчанию — сегодня по дате, переданной с клиента). */
  @Get()
  list(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date();
    const toDate = to ? new Date(to) : new Date(fromDate.getTime() + DAY_MS);
    return this.reservations.list(staff, clubId, fromDate, toDate);
  }

  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservations.create(staff, clubId, dto);
  }

  @Patch(":id")
  setStatus(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("id") id: string,
    @Body() dto: UpdateReservationStatusDto,
  ) {
    return this.reservations.setStatus(staff, clubId, id, dto);
  }
}
