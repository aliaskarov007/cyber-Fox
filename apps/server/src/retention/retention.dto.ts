import { PromoKind } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class RetentionQueryDto {
  /** Сколько дней без визита — и постоянный гость считается ушедшим. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(180)
  days?: number;

  /** Со скольких визитов гость считается постоянным. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  minVisits?: number;
}

export class CreateWinbackDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  guestIds!: string[];

  @IsEnum(PromoKind)
  kind!: PromoKind;

  /** В тиын. Потолок — 20 000 ₸ на гостя: это подарок, а не зарплата. */
  @IsInt()
  @Min(100)
  @Max(2_000_000)
  amount!: number;

  /** Сколько дней действует код. */
  @IsInt()
  @Min(3)
  @Max(60)
  validDays!: number;

  /** Свой текст с подстановками; пусто — текст по умолчанию. */
  @IsOptional()
  @IsString()
  @MaxLength(700)
  message?: string;
}
