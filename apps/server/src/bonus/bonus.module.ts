import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { BonusController } from "./bonus.controller.js";
import { BonusService } from "./bonus.service.js";

@Module({
  controllers: [BonusController],
  providers: [BonusService, ClubAccessService],
})
export class BonusModule {}
