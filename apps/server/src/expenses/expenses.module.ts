import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { ExpensesController } from "./expenses.controller.js";
import { ExpensesService } from "./expenses.service.js";

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ClubAccessService],
})
export class ExpensesModule {}
