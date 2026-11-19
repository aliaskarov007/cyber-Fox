import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CashMovementKind } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { ShiftsService } from "./shifts.service.js";

class OpenShiftDto {
  /** Размен в кассе на начало смены, в тиын. */
  @IsInt()
  @Min(0)
  openingFloat!: number;
}

class CloseShiftDto {
  /** Пересчитанные наличные, в тиын. */
  @IsInt()
  @Min(0)
  cashCounted!: number;

  /** Карта по терминалу, в тиын. Пусто — не сверяли. */
  @IsOptional()
  @IsInt()
  @Min(0)
  cardCounted?: number;

  /** Онлайн по выписке Kaspi, в тиын. Пусто — не сверяли. */
  @IsOptional()
  @IsInt()
  @Min(0)
  onlineCounted?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class CashMovementDto {
  @IsEnum(CashMovementKind)
  kind!: CashMovementKind;

  /** Сумма движения в тиын, всегда положительная. */
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller("clubs/:clubId/shifts")
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get("current")
  current(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
  ) {
    return this.shifts.current(staff, clubId);
  }

  @Get()
  list(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
  ) {
    return this.shifts.list(staff, clubId);
  }

  @Post("open")
  open(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: OpenShiftDto,
  ) {
    return this.shifts.open(staff, clubId, dto.openingFloat);
  }

  @Get(":shiftId/report")
  report(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("shiftId") shiftId: string,
  ) {
    return this.shifts.report(staff, clubId, shiftId);
  }

  @Post(":shiftId/close")
  close(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("shiftId") shiftId: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(staff, clubId, shiftId, {
      cashCounted: dto.cashCounted,
      note: dto.note,
      cardCounted: dto.cardCounted,
      onlineCounted: dto.onlineCounted,
    });
  }

  /** Движение наличных в кассе: внесение, выемка, расход или возврат. */
  @Post(":shiftId/cash-movements")
  addCashMovement(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Param("shiftId") shiftId: string,
    @Body() dto: CashMovementDto,
  ) {
    return this.shifts.addCashMovement(staff, clubId, shiftId, dto);
  }
}
