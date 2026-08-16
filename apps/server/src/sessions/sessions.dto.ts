import { IsInt, IsOptional, IsString, Matches, Min } from "class-validator";

export class StartSessionDto {
  @IsString()
  computerId!: string;

  /** Пусто — анонимная посадка: без кредита и без остатков пакета. */
  @IsOptional()
  @IsString()
  guestId?: string;

  /**
   * Предоплата для анонимной посадки, в тиын. Обязательна, когда гость не указан:
   * списывать поминутно не с чего, поэтому деньги берутся вперёд на стойке.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  prepaidAmount?: number;

  /**
   * Тариф, которым играть. Пусто — система сама возьмёт минуты пакета гостя
   * в этой зоне, а при их отсутствии поминутный тариф зоны.
   */
  @IsOptional()
  @IsString()
  tariffId?: string;
}

export class MoveSessionDto {
  @IsString()
  computerId!: string;
}

export class GuestLoginDto {
  @IsString()
  computerId!: string;

  @IsString()
  phone!: string;

  @Matches(/^\d{4}$/)
  pin!: string;
}
