import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { PcMessagesController } from "./pc-messages.controller.js";
import { PcMessagesService } from "./pc-messages.service.js";

@Module({
  // SessionsModule отдаёт RealtimeBus — один на процесс.
  imports: [SessionsModule],
  controllers: [PcMessagesController],
  providers: [PcMessagesService, ClubAccessService],
})
export class PcMessagesModule {}
