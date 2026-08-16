import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { BuyPackageDto, CreateGuestDto, SetPinDto, TopUpDto } from "./guests.dto.js";
import { GuestsService } from "./guests.service.js";

@Controller("clubs/:clubId/guests")
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get()
  search(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query("q") query = "",
  ) {
    return this.guests.search(staff, clubId, query);
  }

  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateGuestDto,
  ) {
    return this.guests.create(staff, clubId, dto);
  }

  @Get(":guestId")
  get(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
  ) {
    return this.guests.getWithBalance(staff, clubId, guestId);
  }

  @Get(":guestId/history")
  history(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
  ) {
    return this.guests.history(staff, clubId, guestId);
  }

  @Post(":guestId/topup")
  topUp(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
    @Body() dto: TopUpDto,
  ) {
    return this.guests.topUp(staff, clubId, guestId, dto);
  }

  @Post(":guestId/packages")
  buyPackage(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
    @Body() dto: BuyPackageDto,
  ) {
    return this.guests.buyPackage(staff, clubId, guestId, dto);
  }

  @Post(":guestId/pin")
  async setPin(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
    @Body() dto: SetPinDto,
  ) {
    await this.guests.setPin(staff, clubId, guestId, dto.pin);
    return { ok: true };
  }
}
