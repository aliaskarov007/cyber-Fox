import { IsIn, IsOptional, IsString, IsUrl, Matches, MinLength } from "class-validator";

export class SaveWhatsAppDto {
  /** Адрес API из кабинета Green-API; у новых инстансов он вида https://7103.api.greenapi.com. */
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true }, { message: "Адрес API — https-ссылка из кабинета Green-API" })
  apiUrl?: string;

  @Matches(/^\d{6,15}$/, { message: "idInstance — число из кабинета Green-API" })
  instanceId!: string;

  /** Пусто при повторном сохранении — оставить прежний токен. */
  @IsOptional()
  @IsString()
  @MinLength(10, { message: "apiTokenInstance слишком короткий" })
  apiToken?: string;

  /**
   * Адрес, по которому Green-API достучится до сервера, — домен кассового
   * экрана. Его подставляет сам экран: он знает, откуда открыт.
   */
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true, require_tld: true }, {
    message: "Ответы гостей доходят только на публичный https-адрес",
  })
  publicUrl?: string;
}

export class TestMessageDto {
  @IsString()
  @MinLength(5)
  phone!: string;
}

export class SendInvitesDto {
  /** Кого звать: всю сеть или гостей зала ивента. */
  @IsIn(["NETWORK", "CLUB"])
  audience!: "NETWORK" | "CLUB";
}
