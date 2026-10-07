import { Module } from "@nestjs/common";

import { GuestSignupModule } from "../guest-signup/guest-signup.module.js";
import { GreenApiClient } from "./green-api.client.js";
import { InvitesService } from "./invites.service.js";
import { InvitesWorker } from "./invites.worker.js";
import { InvitesController, WhatsAppController, WhatsAppWebhookController } from "./whatsapp.controller.js";
import { WhatsAppService } from "./whatsapp.service.js";

@Module({
  imports: [GuestSignupModule],
  controllers: [WhatsAppController, WhatsAppWebhookController, InvitesController],
  providers: [WhatsAppService, GreenApiClient, InvitesService, InvitesWorker],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
