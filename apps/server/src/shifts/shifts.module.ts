import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { ShiftsController } from "./shifts.controller.js";
import { ShiftsService } from "./shifts.service.js";

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, ClubAccessService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
