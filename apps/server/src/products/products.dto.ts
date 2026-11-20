import { PaymentMethod } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

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

  /** URL картинки товара (загружается отдельно). */
  @IsOptional()
  @IsString()
  imageUrl?: string;
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

  /** URL картинки товара. Пустая строка — убрать картинку. */
  @IsOptional()
  @IsString()
  imageUrl?: string | null;

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

/** Оприходование (приёмка) товара: сколько принято и по какой себестоимости. */
export class ReceiveStockDto {
  @IsInt()
  @Min(1)
  quantity!: number;

  /** Себестоимость за единицу в этой приёмке, в тиын. */
  @IsInt()
  @Min(0)
  unitCost!: number;
}

/** Списание товара со склада: бой, порча, недостача. */
export class WriteOffStockDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}

/** Одна позиция чека: товар и сколько штук. */
export class CartItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/** Продажа нескольких товаров одним чеком за один способ оплаты. */
export class SellCartDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;
}
