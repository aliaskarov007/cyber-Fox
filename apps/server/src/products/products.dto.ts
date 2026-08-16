import { PaymentMethod } from "@prisma/client";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  /** Цена продажи в тиын. */
  @IsInt()
  @Min(0)
  price!: number;

  /** Себестоимость в тиын — нужна для маржи в отчёте. */
  @IsOptional()
  @IsInt()
  @Min(0)
  cost?: number;

  /** Остаток на складе. Пусто — товар без учёта остатков. */
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SellProductDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** Пусто — продажа без привязки к гостю (за наличные на стойке). */
  @IsOptional()
  @IsString()
  guestId?: string;

  /** Заказ прямо с игрового ПК привязывается к его сессии. */
  @IsOptional()
  @IsString()
  sessionId?: string;
}
