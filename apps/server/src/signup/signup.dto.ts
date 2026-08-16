import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class SignupDto {
  @IsString()
  @MinLength(2)
  clubName!: string;

  /** Название сети. Пусто — берём название клуба: у одиночного зала сети нет. */
  @IsOptional()
  @IsString()
  networkName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: "Пароль от восьми символов" })
  password!: string;

  /** Сколько машин завести сразу — коды привязки создадутся вместе с ними. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  computers?: number;

  /** Цена минуты в тиын. Пусто — 10 ₸. */
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerMinute?: number;
}
