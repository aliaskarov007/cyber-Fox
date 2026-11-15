import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class SendPcMessageDto {
  /** ПК, которому слать. Пусто — всем машинам клуба (broadcast). */
  @IsOptional()
  @IsString()
  computerId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}
