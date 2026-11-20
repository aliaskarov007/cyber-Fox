import { ReservationStatus } from "@prisma/client";
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateReservationDto {
  /** Бронируют либо зону, либо машину — одно из двух. */
  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  computerId?: string;

  @IsString()
  @MinLength(1)
  guestName!: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  /** Предоплата в тиын. */
  @IsOptional()
  @IsInt()
  @Min(0)
  prepaid?: number;

  /** Способ предоплаты: CASH / CARD / ONLINE. Проводится в открытую смену. */
  @IsOptional()
  @IsString()
  prepaidMethod?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateReservationStatusDto {
  @IsEnum(ReservationStatus)
  status!: ReservationStatus;
}
