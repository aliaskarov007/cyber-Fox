import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";

@Module({
  imports: [GuestsModule],
  controllers: [ProductsController],
  providers: [ProductsService, ClubAccessService],
  exports: [ProductsService],
})
export class ProductsModule {}
