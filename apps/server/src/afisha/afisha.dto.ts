import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Длины ограничены тем, что помещается в окно афиши на экране ПК. */
export class CreateEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  subtitle?: string;

  @IsDateString()
  startsAt!: string;

  /** Пусто — ивент всей сети или онлайн. */
  @IsOptional()
  @IsString()
  clubId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  prize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  fee?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  seats?: string;

  @IsOptional()
  @IsString()
  @MaxLength(90)
  howToJoin?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  subtitle?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  clubId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  prize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  fee?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  seats?: string;

  @IsOptional()
  @IsString()
  @MaxLength(90)
  howToJoin?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
