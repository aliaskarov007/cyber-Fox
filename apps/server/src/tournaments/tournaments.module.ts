import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { TournamentsController } from "./tournaments.controller.js";
import { TournamentsService } from "./tournaments.service.js";

@Module({
  imports: [GuestsModule],
  controllers: [TournamentsController],
  providers: [TournamentsService, ClubAccessService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
