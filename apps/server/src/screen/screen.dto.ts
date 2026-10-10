import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";

const IMAGE_URL = /^\/api\/covers\/[\w.-]+$/;

export class CreateSlideDto {
  @IsString()
  @MaxLength(60)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  text?: string;

  /** Картинка, загруженная через настройки. */
  @IsOptional()
  @IsString()
  @Matches(IMAGE_URL, { message: "Загрузите картинку через настройки" })
  imageUrl?: string;

  /** Имя партнёра — на слайде появится пометка «Реклама». */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  partner?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  /** Крутить во всех залах сети — решение владельца. */
  @IsOptional()
  @IsBoolean()
  networkWide?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSlideDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
