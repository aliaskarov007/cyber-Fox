import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ReservationsController } from "./reservations.controller.js";
import { ReservationsScheduler } from "./reservations.scheduler.js";
import { ReservationsService } from "./reservations.service.js";

@Module({
  // SessionsModule отдаёт SessionsService и общий RealtimeBus (один на процесс).
  imports: [SessionsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationsScheduler, ClubAccessService],
})
export class ReservationsModule {}
