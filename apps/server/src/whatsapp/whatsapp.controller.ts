import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Public, Roles } from "../auth/guards.js";
import { PhoneVerificationService } from "./phone-verification.service.js";
import { ConfirmCodeDto, SaveWhatsAppDto, TestMessageDto } from "./whatsapp.dto.js";
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

/** Входящие уведомления Green-API: ответы гостей на приглашения. */
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

/** Подтверждение номера гостя — на стойке, любым сотрудником зала. */
@Controller("clubs/:clubId/guests/:guestId/phone")
export class PhoneVerificationController {
  constructor(private readonly verification: PhoneVerificationService) {}

  @Post("send-code")
  sendCode(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
  ) {
    return this.verification.sendCode(staff, clubId, guestId);
  }

  @Post("confirm")
  confirm(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("guestId") guestId: string,
    @Body() dto: ConfirmCodeDto,
  ) {
    return this.verification.confirm(staff, clubId, guestId, dto.code);
  }
}
