import { StaffRole } from "@prisma/client";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateClubDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  city?: string;

  /** Часовой пояс зала: по нему наступают тарифы по времени суток. */
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class UpdateClubDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** Лимит игры в долг, в тиын. */
  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  packageValidityDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowBalanceWarnMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  bonusPercent?: number;

  /** Подарок за согласие на приглашения, в тиын. 0 — без подарка. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  consentBonus?: number;

  /** Перенос остатка абонемента: процент при продлении. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloverPercent?: number;

  /** То же с третьего абонемента подряд. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloverStreakPercent?: number;

  /** Потолок переноса, процент от оплаченных минут нового абонемента. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloverCapPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  renewBeforeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  renewAfterDays?: number;
}

export class CreateStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(StaffRole)
  role!: StaffRole;

  /** Клуб сотрудника. Пусто — владелец сети, видит все залы. */
  @IsOptional()
  @IsString()
  clubId?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @IsOptional()
  @IsString()
  clubId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  /** Один кошелёк на сеть или свой в каждом клубе. */
  @IsOptional()
  @IsBoolean()
  sharedBalance?: boolean;

  /** Лозунг под названием сети на экране блокировки. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  slogan?: string;

  /**
   * Куда переносить остатки при выключении общего кошелька.
   * Разделить общий остаток по клубам корректно нельзя — система не знает,
   * чьи это деньги, поэтому клуб указывает владелец.
   */
  @IsOptional()
  @IsString()
  moveBalancesToClubId?: string;
}
