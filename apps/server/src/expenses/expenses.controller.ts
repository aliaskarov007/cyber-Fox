import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { CreateExpenseDto } from "./expenses.dto.js";
import { ExpensesService } from "./expenses.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Расходы и прибыль — забота владельца и управляющего, не кассира.
@Roles(StaffRole.OWNER, StaffRole.ADMIN)
@Controller("clubs/:clubId/expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * DAY_MS);
    const toDate = to ? new Date(to) : new Date();
    return this.expenses.list(staff, clubId, fromDate, toDate);
  }

  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expenses.create(staff, clubId, dto);
  }

  @Delete(":id")
  remove(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("id") id: string,
  ) {
    return this.expenses.remove(staff, clubId, id);
  }
}
