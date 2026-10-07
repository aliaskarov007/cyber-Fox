import { EventAudience } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  /** Уходит в приглашении как есть: формат, призы, взнос. */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @IsDateString({}, { message: "Укажите дату и время начала" })
  startsAt!: string;

  @IsOptional()
  @IsEnum(EventAudience)
  audience?: EventAudience;
}

export class AudienceQueryDto {
  @IsOptional()
  @IsEnum(EventAudience)
  audience?: EventAudience;
}
