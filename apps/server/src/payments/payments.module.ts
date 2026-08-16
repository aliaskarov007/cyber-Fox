import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { HmacPaymentProvider } from "./payment.provider.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [GuestsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, HmacPaymentProvider, ClubAccessService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
