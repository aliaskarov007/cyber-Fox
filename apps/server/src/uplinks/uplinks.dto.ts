import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class SaveRouterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  host!: string;

  /** 0 — драйвер сам подставит умолчание (443 REST / 8728 API). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  apiPort?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  username!: string;

  /** Пустое поле — не менять уже сохранённый пароль. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  password?: string;

  @IsOptional()
  @IsIn(["ROS7", "ROS6"])
  driver?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowMidSession?: boolean;
}

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  /** Имя address-list/маршрута на роутере. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  routerMark!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  routerMark?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
