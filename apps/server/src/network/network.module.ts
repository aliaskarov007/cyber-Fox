import { Module } from "@nestjs/common";

import { SessionsModule } from "../sessions/sessions.module.js";
import { NetworkController } from "./network.controller.js";
import { NetworkService } from "./network.service.js";

// Шина — из SessionsModule: подпись сети рассылается на экраны ПК.
@Module({
  imports: [SessionsModule],
  controllers: [NetworkController],
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworkModule {}
