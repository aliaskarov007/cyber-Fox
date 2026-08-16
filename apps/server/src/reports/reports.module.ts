import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ClubAccessService],
  exports: [ReportsService],
})
export class ReportsModule {}
