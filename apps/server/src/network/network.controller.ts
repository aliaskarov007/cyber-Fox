import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import {
  CreateClubDto,
  CreateStaffDto,
  UpdateClubDto,
  UpdateStaffDto,
  UpdateTenantDto,
} from "./network.dto.js";
import { NetworkService } from "./network.service.js";

@Controller("network")
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  @Get("tenant")
  tenant(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.network.tenant(staff);
  }

  @Roles(StaffRole.OWNER)
  @Patch("tenant")
  updateTenant(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: UpdateTenantDto) {
    return this.network.updateTenant(staff, dto);
  }

  @Roles(StaffRole.OWNER)
  @Post("clubs")
  createClub(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: CreateClubDto) {
    return this.network.createClub(staff, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch("clubs/:clubId")
  updateClub(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: UpdateClubDto,
  ) {
    return this.network.updateClub(staff, clubId, dto);
  }

  @Get("staff")
  listStaff(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.network.listStaff(staff);
  }

  @Roles(StaffRole.OWNER)
  @Post("staff")
  createStaff(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: CreateStaffDto) {
    return this.network.createStaff(staff, dto);
  }

  @Roles(StaffRole.OWNER)
  @Patch("staff/:staffId")
  updateStaff(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("staffId") staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.network.updateStaff(staff, staffId, dto);
  }
}
