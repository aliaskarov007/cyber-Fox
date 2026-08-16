import { Body, Controller, Param, Post } from "@nestjs/common";
import { StaffRole } from "@prisma/client";
import { IsString, MinLength } from "class-validator";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { CurrentStaff } from "../auth/current-staff.decorator.js";
import { Roles } from "../auth/guards.js";
import { ImportService } from "./import.service.js";

class ImportDto {
  /** Содержимое файла как есть: разделитель и кодировку разбирает сервер. */
  @IsString()
  @MinLength(1)
  csv!: string;
}

@Controller("clubs/:clubId/import")
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("guests")
  guests(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: ImportDto,
  ) {
    return this.imports.guests(staff, clubId, dto.csv);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("computers")
  computers(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: ImportDto,
  ) {
    return this.imports.computers(staff, clubId, dto.csv);
  }

  @Roles(StaffRole.OWNER, StaffRole.ADMIN)
  @Post("tariffs")
  tariffs(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param("clubId") clubId: string,
    @Body() dto: ImportDto,
  ) {
    return this.imports.tariffs(staff, clubId, dto.csv);
  }
}
