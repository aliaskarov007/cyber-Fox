import { ReservationStatus } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateReservationDto {
  /**
   * Зона брони. Для гибкой брони задаётся всегда; внутри неё — либо вся зона,
   * либо конкретные ПК (computerIds), либо количество (quantity).
   */
  @IsOptional()
  @IsString()
  zoneId?: string;

  /** Устаревшее: бронь одного ПК. Новый клиент шлёт computerIds. */
  @IsOptional()
  @IsString()
  computerId?: string;

  /** Конкретные ПК зоны (режим «выбрать ПК» или диапазон). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  computerIds?: string[];

  /** Количество ПК в зоне без указания номеров (режим «на количество»). */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

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
