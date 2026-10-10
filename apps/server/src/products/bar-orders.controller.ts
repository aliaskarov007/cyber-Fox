import { Controller, Get, Param, Post } from "@nestjs/common";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { BarOrdersService } from "./bar-orders.service.js";

/** Заказы из бара с игровых ПК. Разносит и отменяет любой сотрудник смены. */
@Controller("clubs/:clubId/bar-orders")
export class BarOrdersController {
  constructor(private readonly orders: BarOrdersService) {}

  @Get()
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.orders.list(staff, clubId);
  }

  @Post(":orderId/done")
  complete(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("orderId") orderId: string,
  ) {
    return this.orders.complete(staff, clubId, orderId);
  }

  @Post(":orderId/cancel")
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("orderId") orderId: string,
  ) {
    return this.orders.cancel(staff, clubId, orderId);
  }
}
