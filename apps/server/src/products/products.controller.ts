import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { CreateProductDto, SellProductDto, UpdateProductDto } from "./products.dto.js";
import { ProductsService } from "./products.service.js";

@Controller("clubs/:clubId/products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentStaff() staff: AuthenticatedStaff, @Param("clubId") clubId: string) {
    return this.products.list(staff, clubId);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(staff, clubId, dto);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Patch(":productId")
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("productId") productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(staff, clubId, productId, dto);
  }

  /** Продажа доступна любому сотруднику: это основная операция смены. */
  @Post("sell")
  sell(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: SellProductDto,
  ) {
    return this.products.sell(staff, clubId, dto);
  }
}
