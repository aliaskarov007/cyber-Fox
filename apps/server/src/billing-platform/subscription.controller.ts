import { Body, Controller, Get, Post } from "@nestjs/common";
import { StaffRole, SubscriptionPlan } from "@prisma/client";
import { IsEnum } from "class-validator";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { PLANS } from "./subscription.rules.js";
import { SubscriptionService } from "./subscription.service.js";

class ChangePlanDto {
  @IsEnum(SubscriptionPlan)
  plan!: SubscriptionPlan;
}

@Controller("subscription")
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  /** Состояние подписки и что доступно прямо сейчас. */
  @Get()
  async current(@CurrentStaff() staff: AuthenticatedStaff) {
    const [subscription, access] = await Promise.all([
      this.subscriptions.forTenant(staff.tenantId),
      this.subscriptions.access(staff.tenantId),
    ]);
    return { subscription, access, plans: Object.values(PLANS) };
  }

  @Get("invoices")
  invoices(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.subscriptions.invoices(staff.tenantId);
  }

  @Roles(StaffRole.OWNER)
  @Post("plan")
  changePlan(@CurrentStaff() staff: AuthenticatedStaff, @Body() dto: ChangePlanDto) {
    return this.subscriptions.changePlan(staff, dto.plan);
  }
}
