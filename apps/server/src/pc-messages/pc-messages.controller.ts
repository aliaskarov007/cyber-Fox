import { Body, Controller, Param, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { SendPcMessageDto } from "./pc-messages.dto.js";
import { PcMessagesService } from "./pc-messages.service.js";

@Controller()
export class PcMessagesController {
  constructor(private readonly messages: PcMessagesService) {}

  /** Кассир или админ шлёт сообщение на экран ПК (или всем машинам клуба). */
  @Roles(StaffRole.OWNER, StaffRole.ADMIN, StaffRole.STAFF)
  @Post("clubs/:clubId/pc-message")
  send(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: SendPcMessageDto,
  ) {
    return this.messages.send(staff, clubId, dto);
  }
}
