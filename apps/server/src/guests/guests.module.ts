import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { ConsentService } from "./consent.service.js";
import { GuestsController } from "./guests.controller.js";
import { GuestsService } from "./guests.service.js";
import { WalletService } from "./wallet.service.js";

@Module({
  controllers: [GuestsController],
  providers: [GuestsService, WalletService, ConsentService, ClubAccessService],
  exports: [GuestsService, WalletService, ConsentService],
})
export class GuestsModule {}
