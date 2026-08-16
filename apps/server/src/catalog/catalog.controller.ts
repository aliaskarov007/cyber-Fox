import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { ClubAccessService } from "../common/club-access.service.js";
import {
  CreateComputerDto,
  CreateTariffDto,
  CreateZoneDto,
  UpdateComputerDto,
  UpdateTariffDto,
  UpdateZoneDto,
} from "./catalog.dto.js";
import { CatalogService } from "./catalog.service.js";

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly access: ClubAccessService,
  ) {}

  @Get("clubs")
  listClubs(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.access.listAccessibleClubs(staff);
  }

  @Get("clubs/:clubId/zones")
  listZones(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.catalog.listZones(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("clubs/:clubId/zones")
  createZone(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.catalog.createZone(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch("clubs/:clubId/zones/:zoneId")
  updateZone(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("zoneId") zoneId: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.catalog.updateZone(staff, clubId, zoneId, dto);
  }

  @Get("clubs/:clubId/computers")
  listComputers(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.catalog.listComputers(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("clubs/:clubId/computers")
  createComputer(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateComputerDto,
  ) {
    return this.catalog.createComputer(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch("clubs/:clubId/computers/:computerId")
  updateComputer(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("computerId") computerId: string,
    @Body() dto: UpdateComputerDto,
  ) {
    return this.catalog.updateComputer(staff, clubId, computerId, dto);
  }

  @Get("clubs/:clubId/tariffs")
  listTariffs(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.catalog.listTariffs(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("clubs/:clubId/tariffs")
  createTariff(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateTariffDto,
  ) {
    return this.catalog.createTariff(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch("clubs/:clubId/tariffs/:tariffId")
  updateTariff(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("tariffId") tariffId: string,
    @Body() dto: UpdateTariffDto,
  ) {
    return this.catalog.updateTariff(staff, clubId, tariffId, dto);
  }
}
