import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  networkName!: string;

  @IsString()
  @MinLength(2)
  clubName!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsEmail()
  email!: string;

  /** Пароль владельца: его передают клубу, поэтому короткий не годится. */
  @IsString()
  @MinLength(8)
  password!: string;
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxComputers?: number;

  /** Продлить пробный период на столько дней, считая от сегодня. */
  @IsOptional()
  @IsInt()
  @Min(1)
  trialDays?: number;
}
