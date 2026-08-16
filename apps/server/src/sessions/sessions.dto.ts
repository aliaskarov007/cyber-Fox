import { IsOptional, IsString, Matches } from "class-validator";

export class StartSessionDto {
  @IsString()
  computerId!: string;

  /** Пусто — анонимная посадка: без кредита и без остатков пакета. */
  @IsOptional()
  @IsString()
  guestId?: string;

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
