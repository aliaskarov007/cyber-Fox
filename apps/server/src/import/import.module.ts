import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { ImportController } from "./import.controller.js";
import { ImportService } from "./import.service.js";

@Module({
  imports: [GuestsModule],
  controllers: [ImportController],
  providers: [ImportService, ClubAccessService],
})
export class ImportModule {}
