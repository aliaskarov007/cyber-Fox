import { StaffRole } from "@prisma/client";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
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

  /**
   * Куда переносить остатки при выключении общего кошелька.
   * Разделить общий остаток по клубам корректно нельзя — система не знает,
   * чьи это деньги, поэтому клуб указывает владелец.
   */
  @IsOptional()
  @IsString()
  moveBalancesToClubId?: string;
}
