import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ApiPayClient } from "./apipay.client.js";
import { KaspiController } from "./kaspi.controller.js";
import { KaspiService } from "./kaspi.service.js";
import { HmacPaymentProvider } from "./payment.provider.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [GuestsModule, SessionsModule],
  controllers: [PaymentsController, KaspiController],
  providers: [PaymentsService, HmacPaymentProvider, ClubAccessService, ApiPayClient, KaspiService],
  exports: [PaymentsService, KaspiService],
})
export class PaymentsModule {}
