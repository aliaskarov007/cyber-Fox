import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, ClubAccessService],
  exports: [CatalogService, ClubAccessService],
})
export class CatalogModule {}
