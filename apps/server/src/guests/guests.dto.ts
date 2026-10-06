import { PaymentMethod } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from "class-validator";

export class CreateGuestDto {
  /** Необязательно: без имени гость записывается как «Гость 4567». */
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  /** PIN для самостоятельного входа. Можно не задавать — гость придумает сам за ПК. */
  @IsOptional()
  @Matches(/^\d{4}$/, { message: "PIN — четыре цифры" })
  pin?: string;

  /** Гость сказал администратору, что согласен на приглашения. */
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}

export class ConsentDto {
  @IsBoolean()
  consent!: boolean;
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
