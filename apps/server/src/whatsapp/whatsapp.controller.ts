import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Public, Roles } from "../auth/guards.js";
import { type Audience, InvitesService } from "./invites.service.js";
import { SaveWhatsAppDto, SendInvitesDto, TestMessageDto } from "./whatsapp.dto.js";
import { WhatsAppService } from "./whatsapp.service.js";

/** Подключение WhatsApp — забота владельца: это номер всей сети. */
@Controller("network/whatsapp")
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  get(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.whatsapp.get(staff);
  }

  @Roles(StaffRole.OWNER)
  @Put()
  save(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: SaveWhatsAppDto) {
    return this.whatsapp.save(staff, dto);
  }

  @Roles(StaffRole.OWNER)
  @Post("check")
  check(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.whatsapp.checkState(staff);
  }

  @Roles(StaffRole.OWNER)
  @Post("test")
  test(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: TestMessageDto) {
    return this.whatsapp.sendTest(staff, dto.phone);
  }

  @Roles(StaffRole.OWNER)
  @Delete()
  disconnect(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.whatsapp.disconnect(staff);
  }
}

/** Входящие уведомления Green-API: коды регистрации, «СТОП» и ответы на приглашения. */
@Controller("whatsapp")
export class WhatsAppWebhookController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Public()
  @HttpCode(200)
  @Post("webhook")
  async webhook(@Headers("authorization") authorization: string | undefined, @Body() payload: unknown) {
    await this.whatsapp.handleWebhook(authorization, payload);
    return { ok: true };
  }
}

/** Приглашения на ивенты афиши: смотреть может любой сотрудник, рассылать — владелец и управляющие. */
@Controller("network/events")
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get("invites")
  summaries(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.invites.summaries(staff);
  }

  @Get(":eventId/invites")
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("eventId") eventId: string) {
    return this.invites.list(staff, eventId);
  }

  @Get(":eventId/audience")
  audience(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("eventId") eventId: string,
    @Query("audience") audience: string | undefined,
  ) {
    return this.invites.audienceSize(staff, eventId, (audience === "CLUB" ? "CLUB" : "NETWORK") as Audience);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post(":eventId/invites")
  send(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("eventId") eventId: string,
    @Body() dto: SendInvitesDto,
  ) {
    return this.invites.send(staff, eventId, dto.audience);
  }
}
