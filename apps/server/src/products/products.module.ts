import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { GuestsModule } from "../guests/guests.module.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { BarOrdersController } from "./bar-orders.controller.js";
import { BarOrdersService } from "./bar-orders.service.js";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";

@Module({
  imports: [GuestsModule, SessionsModule],
  controllers: [ProductsController, BarOrdersController],
  providers: [ProductsService, BarOrdersService, ClubAccessService],
  exports: [ProductsService, BarOrdersService],
})
export class ProductsModule {}
