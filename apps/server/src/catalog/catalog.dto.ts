import { PartialType } from "@nestjs/mapped-types";
import { TariffKind } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class CreateZoneDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /** Тариф, подхватываемый когда минуты пакета кончились. */
  @IsOptional()
  @IsString()
  defaultPerMinuteTariffId?: string;
}

export class CreateComputerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  zoneId!: string;
}

export class UpdateComputerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;
}

export class CreateTariffDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  zoneId!: string;

  @IsEnum(TariffKind)
  kind!: TariffKind;

  /** Для PER_MINUTE: цена минуты в тиын. */
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerMinute?: number;

  /** Для PACKAGE: сколько минут и за сколько. */
  @IsOptional()
  @IsInt()
  @Min(1)
  packageMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  packagePrice?: number;

  /** Срок жизни пакета; пусто — берём настройку клуба. */
  @IsOptional()
  @IsInt()
  @Min(1)
  validityDays?: number;

  @IsOptional()
  @IsString()
  fallbackTariffId?: string;

  /** Окно действия по времени суток, минуты от полуночи. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  activeFromMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  activeToMinute?: number;

  /** Дни недели, 1 = понедельник. Пусто — все дни. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek?: number[];
}

/*
 * Правка тарифа частичная. Наследование от CreateTariffDto без PartialType
 * оставляло бы обязательными название, зону и вид: касса выключает тариф одним
 * полем isActive, и такой запрос отклонялся бы с требованием прислать всё
 * остальное.
 */
export class UpdateTariffDto extends PartialType(CreateTariffDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
