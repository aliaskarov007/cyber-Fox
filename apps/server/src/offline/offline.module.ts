import { Module } from "@nestjs/common";

import { SessionsModule } from "../sessions/sessions.module.js";
import { OfflineService } from "./offline.service.js";

@Module({
  imports: [SessionsModule],
  providers: [OfflineService],
  exports: [OfflineService],
})
export class OfflineModule {}
