import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { GuestSignupService } from "./guest-signup.service.js";
import { GreenApiClient } from "./green-api.client.js";
import { PhoneVerificationService } from "./phone-verification.service.js";
import {
  PhoneVerificationController,
  WhatsAppController,
  WhatsAppWebhookController,
} from "./whatsapp.controller.js";
import { WhatsAppService } from "./whatsapp.service.js";

@Module({
  // Шина событий живёт в модуле сессий: свой экземпляр здесь значил бы, что
  // подтверждение регистрации не дойдёт до экрана машины.
  imports: [SessionsModule],
  controllers: [WhatsAppController, WhatsAppWebhookController, PhoneVerificationController],
  providers: [
    WhatsAppService,
    GreenApiClient,
    PhoneVerificationService,
    GuestSignupService,
    ClubAccessService,
  ],
  exports: [WhatsAppService, GuestSignupService],
})
export class WhatsAppModule {}
