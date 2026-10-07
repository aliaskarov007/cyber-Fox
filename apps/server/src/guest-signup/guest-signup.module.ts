import { Module } from "@nestjs/common";

import { GuestsModule } from "../guests/guests.module.js";
import { GuestSignupService } from "./guest-signup.service.js";
import { WhatsappController } from "./whatsapp.controller.js";

@Module({
  imports: [GuestsModule],
  controllers: [WhatsappController],
  providers: [GuestSignupService],
  exports: [GuestSignupService],
})
export class GuestSignupModule {}
