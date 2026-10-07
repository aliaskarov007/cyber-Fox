import { Module } from "@nestjs/common";

import { GuestsModule } from "../guests/guests.module.js";
import { GuestSignupService } from "./guest-signup.service.js";
import { WhatsappStatusController } from "./whatsapp-status.controller.js";
import { WhatsappController } from "./whatsapp.controller.js";
import { WhatsappMonitor } from "./whatsapp.monitor.js";

@Module({
  imports: [GuestsModule],
  controllers: [WhatsappController, WhatsappStatusController],
  providers: [GuestSignupService, WhatsappMonitor],
  exports: [GuestSignupService],
})
export class GuestSignupModule {}
