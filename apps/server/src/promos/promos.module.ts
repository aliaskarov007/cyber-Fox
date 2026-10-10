import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { PromosController } from "./promos.controller.js";
import { PromosService } from "./promos.service.js";

@Module({
  imports: [GuestsModule, SessionsModule],
  controllers: [PromosController],
  providers: [PromosService, ClubAccessService],
  exports: [PromosService],
})
export class PromosModule {}
