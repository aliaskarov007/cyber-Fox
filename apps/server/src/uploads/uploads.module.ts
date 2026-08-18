import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { UploadsController } from "./uploads.controller.js";

@Module({
  controllers: [UploadsController],
  providers: [ClubAccessService],
})
export class UploadsModule {}
