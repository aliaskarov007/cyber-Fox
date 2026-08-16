import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import { SessionsController } from "./sessions.controller.js";
import { SessionsService } from "./sessions.service.js";
import { SessionsWorker } from "./sessions.worker.js";

@Module({
  imports: [GuestsModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsWorker, ClubAccessService, RealtimeBus],
  exports: [SessionsService, RealtimeBus],
})
export class SessionsModule {}
