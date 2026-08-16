import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsController } from "./guests.controller.js";
import { GuestsService } from "./guests.service.js";
import { WalletService } from "./wallet.service.js";

@Module({
  controllers: [GuestsController],
  providers: [GuestsService, WalletService, ClubAccessService],
  exports: [GuestsService, WalletService],
})
export class GuestsModule {}
