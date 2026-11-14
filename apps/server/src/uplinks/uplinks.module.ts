import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { UplinksController } from "./uplinks.controller.js";
import { UplinksService } from "./uplinks.service.js";

@Module({
  controllers: [UplinksController],
  providers: [UplinksService, ClubAccessService],
  exports: [UplinksService],
})
export class UplinksModule {}
