import { ExpenseCategory } from "@prisma/client";
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class CreateExpenseDto {
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  /** Сумма расхода в тиын. */
  @IsInt()
  @Min(1)
  amount!: number;

  /** Дата расхода. */
  @IsISO8601()
  spentAt!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
