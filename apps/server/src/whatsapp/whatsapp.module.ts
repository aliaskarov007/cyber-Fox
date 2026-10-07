import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GreenApiClient } from "./green-api.client.js";
import { PhoneVerificationService } from "./phone-verification.service.js";
import {
  PhoneVerificationController,
  WhatsAppController,
  WhatsAppWebhookController,
} from "./whatsapp.controller.js";
import { WhatsAppService } from "./whatsapp.service.js";

@Module({
  controllers: [WhatsAppController, WhatsAppWebhookController, PhoneVerificationController],
  providers: [WhatsAppService, GreenApiClient, PhoneVerificationService, ClubAccessService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
