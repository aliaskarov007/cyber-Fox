import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { GuestsModule } from "../guests/guests.module.js";
import { LibraryModule } from "../library/library.module.js";
import { OfflineModule } from "../offline/offline.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AgentService } from "./agent.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";

@Module({
  imports: [AuthModule, SessionsModule, GuestsModule, OfflineModule, LibraryModule],
  providers: [RealtimeGateway, AgentService],
})
export class RealtimeModule {}
