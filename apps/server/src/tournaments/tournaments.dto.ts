import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** Турнирная часть ивента. Без неё ивент остаётся обычной афишей. */
export class CreateTournamentDto {
  /** Сколько человек в команде. 1 — турнир одиночек. */
  @IsInt()
  @Min(1)
  @Max(10)
  teamSize!: number;

  /** Сколько команд помещается. */
  @IsInt()
  @Min(2)
  @Max(256)
  slots!: number;

  /** Взнос с человека, в тиын. */
  @IsInt()
  @Min(0)
  entryFee!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  clubFeePercent?: number;

  /** Сколько клуб добавляет в фонд от себя, в тиын. */
  @IsOptional()
  @IsInt()
  @Min(0)
  clubBonus?: number;

  /** Доли призовых мест в процентах. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100, { each: true })
  prizeSplit?: number[];

  /** Сколько минут неполная команда держит место. */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(10080)
  gatherWindowMinutes?: number;
}

export class AssignFreeAgentDto {
  @IsString()
  entryId!: string;

  @IsString()
  teamId!: string;
}

export class PayPrizesDto {
  /** Команды-победители по порядку мест. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  teamIds!: string[];
}
