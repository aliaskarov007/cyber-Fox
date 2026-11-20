import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { ReservationsController } from "./reservations.controller.js";
import { ReservationsService } from "./reservations.service.js";

@Module({
  controllers: [ReservationsController],
  providers: [ReservationsService, ClubAccessService],
})
export class ReservationsModule {}
