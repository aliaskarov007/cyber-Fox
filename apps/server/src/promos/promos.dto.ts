import { PromoKind } from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreatePromoDto {
  /** Пусто — код придумает сервер. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @IsEnum(PromoKind)
  kind!: PromoKind;

  /** В тиын. Потолок — сто тысяч тенге: опечатка в нулях не должна раздать кассу. */
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  amount!: number;

  /** Сколько гостей всего могут ввести код. Пусто — без ограничения. */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  /** Код для всех залов сети. Заводит только владелец. */
  @IsOptional()
  @IsBoolean()
  networkWide?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;
}

export class RedeemPromoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;
}
