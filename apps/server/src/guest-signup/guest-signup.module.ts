import { Module } from "@nestjs/common";

import { GuestsModule } from "../guests/guests.module.js";
import { GuestSignupService } from "./guest-signup.service.js";
import { PrivacyController } from "./privacy.controller.js";

@Module({
  imports: [GuestsModule],
  controllers: [PrivacyController],
  providers: [GuestSignupService],
  exports: [GuestSignupService],
})
export class GuestSignupModule {}
