import { PaymentMethod } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from "class-validator";

export class CreateGuestDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  /** PIN для самостоятельного входа за игровым ПК. */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: "PIN — четыре цифры" })
  pin?: string;
}

export class TopUpDto {
  /** Сумма в тиын. */
  @IsInt()
  @Min(1)
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;
}

export class BuyPackageDto {
  @IsString()
  tariffId!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;
}

export class SetPinDto {
  @Matches(/^\d{4}$/, { message: "PIN — четыре цифры" })
  pin!: string;
}
