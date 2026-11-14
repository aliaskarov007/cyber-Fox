import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import {
  CreateChannelDto,
  SaveRouterDto,
  UpdateChannelDto,
} from "./uplinks.dto.js";
import { UplinksService } from "./uplinks.service.js";

@Controller()
export class UplinksController {
  constructor(private readonly uplinks: UplinksService) {}

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Get("clubs/:clubId/internet")
  get(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
  ) {
    return this.uplinks.get(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Put("clubs/:clubId/internet/router")
  saveRouter(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: SaveRouterDto,
  ) {
    return this.uplinks.saveRouter(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Delete("clubs/:clubId/internet/router")
  deleteRouter(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
  ) {
    return this.uplinks.deleteRouter(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("clubs/:clubId/internet/channels")
  addChannel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.uplinks.addChannel(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch("clubs/:clubId/internet/channels/:channelId")
  updateChannel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("channelId") channelId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.uplinks.updateChannel(staff, clubId, channelId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Delete("clubs/:clubId/internet/channels/:channelId")
  deleteChannel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("channelId") channelId: string,
  ) {
    return this.uplinks.deleteChannel(staff, clubId, channelId);
  }
}
