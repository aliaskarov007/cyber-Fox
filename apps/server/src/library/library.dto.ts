import { PartialType } from "@nestjs/mapped-types";
import { AppLaunchKind, AppSection } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateAppDto {
  @IsString()
  @MinLength(1)
  name!: string;

  /** Полка в оболочке: «Шутеры», «Программы». Пусто — общая полка. */
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(AppLaunchKind)
  kind?: AppLaunchKind;

  /** Вкладка оболочки: игра или программа. */
  @IsOptional()
  @IsEnum(AppSection)
  section?: AppSection;

  /** Путь к программе на машине зала либо ссылка запуска. */
  @IsString()
  @MinLength(1)
  target!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  args?: string[];

  @IsOptional()
  @IsString()
  coverUrl?: string;

  /** Зона, если игра только для неё. Пусто — во всех зонах клуба. */
  @IsOptional()
  @IsString()
  zoneId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/*
 * Правка частичная. Касса прячет игру одним полем isActive, и требовать при
 * этом название с путём означало бы отказ на каждое нажатие — ровно тот случай,
 * на котором уже спотыкались тарифы.
 */
export class UpdateAppDto extends PartialType(CreateAppDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Отобранное владельцем из найденного агентами. */
export class AcceptSuggestionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}
