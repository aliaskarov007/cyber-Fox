import { Module } from "@nestjs/common";

import { GuestsModule } from "../guests/guests.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { OfflineService } from "./offline.service.js";

@Module({
  imports: [SessionsModule, GuestsModule],
  providers: [OfflineService],
  exports: [OfflineService],
})
export class OfflineModule {}
