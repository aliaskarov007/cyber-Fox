import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { WhatsAppModule } from "../whatsapp/whatsapp.module.js";
import { RetentionController } from "./retention.controller.js";
import { RetentionService } from "./retention.service.js";
import { RetentionWorker } from "./retention.worker.js";

@Module({
  imports: [WhatsAppModule],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionWorker, ClubAccessService],
})
export class RetentionModule {}
