import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";
import { EventsWorker } from "./events.worker.js";

@Module({
  imports: [WhatsAppModule],
  controllers: [EventsController],
  providers: [EventsService, EventsWorker, ClubAccessService],
})
export class EventsModule {}
