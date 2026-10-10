import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ScreenController } from "./screen.controller.js";
import { ScreenService } from "./screen.service.js";

@Module({
  // RealtimeBus приходит из SessionsModule — один на процесс.
  imports: [SessionsModule],
  controllers: [ScreenController],
  providers: [ScreenService, ClubAccessService],
  exports: [ScreenService],
})
export class ScreenModule {}
