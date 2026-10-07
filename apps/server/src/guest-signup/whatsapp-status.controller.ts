import { Controller, Get, Header } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { Public } from "../auth/guards.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WhatsappMonitor } from "./whatsapp.monitor.js";

/** Состояние подключения WhatsApp для экрана настроек кассы. */
@Controller("whatsapp")
export class WhatsappStatusController {
  constructor(
    private readonly config: ConfigService,
    private readonly monitor: WhatsappMonitor,
    private readonly prisma: PrismaService,
  ) {}

  @Get("status")
  status() {
    const value = (name: string): string => this.config.get<string>(name)?.trim() ?? "";
    const number = value("WHATSAPP_NUMBER");
    return {
      number: number || null,
      // Сами секреты наружу не отдаём — только то, что они вписаны.
      hasAppSecret: value("WHATSAPP_APP_SECRET") !== "",
      hasVerifyToken: value("WHATSAPP_VERIFY_TOKEN") !== "",
      /** Регистрация с ПК ждёт сообщения в WhatsApp только когда это true. */
      active: number !== "" && value("WHATSAPP_APP_SECRET") !== "",
      lastVerifiedAt: this.monitor.lastVerifiedAt,
      lastMessageAt: this.monitor.lastMessageAt,
      lastMessageFrom: this.monitor.lastMessageFrom,
      lastSignatureFailureAt: this.monitor.lastSignatureFailureAt,
    };
  }

  /**
   * Политика конфиденциальности. Meta не переводит приложение WhatsApp в рабочий
   * режим без ссылки на неё, а у клуба своего сайта может не быть.
   *
   * Реквизиты берутся из настроек сервера (PRIVACY_COMPANY, PRIVACY_CONTACT), а
   * название — из сети. Текст — образец: перед публикацией его стоит показать юристу.
   */
  @Public()
  @Get("privacy")
  @Header("Content-Type", "text/html; charset=utf-8")
  async privacy(): Promise<string> {
    const tenant = await this.prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
    const brand = escape(tenant?.name ?? "Компьютерный клуб");
    const company = escape(this.config.get<string>("PRIVACY_COMPANY")?.trim() || brand);
    const contact = escape(this.config.get<string>("PRIVACY_CONTACT")?.trim() || "у администратора клуба");
    return privacyPage(brand, company, contact);
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function privacyPage(brand: string, company: string, contact: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Политика конфиденциальности — ${brand}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1a1a1a}h1{font-size:26px}h2{font-size:19px;margin-top:28px}</style>
</head><body>
<h1>Политика конфиденциальности ${brand}</h1>
<p>Оператор персональных данных — ${company}. Политика описывает, какие данные гостей клуба мы обрабатываем и зачем.</p>
<h2>Какие данные</h2>
<p>Номер телефона, имя (если гость его назвал), PIN для входа в виде необратимого хеша, история визитов, баланс и пакеты времени, согласие на приглашения с датой и текстом согласия.</p>
<h2>Зачем</h2>
<p>Чтобы гость входил за игровой компьютер по номеру и PIN, чтобы вести его счёт и пакеты времени во всех клубах сети и, только при отдельном согласии, приглашать его на турниры и события клубов.</p>
<h2>Подтверждение номера через WhatsApp</h2>
<p>При регистрации гость сам отправляет клубу сообщение с кодом в WhatsApp. Мы получаем номер отправителя и текст сообщения только для того, чтобы подтвердить, что номер принадлежит гостю. Других данных из WhatsApp мы не получаем.</p>
<h2>Приглашения</h2>
<p>Приглашения приходят только тем, кто согласился. Отписаться можно в любой момент: ответить «СТОП» в WhatsApp клуба или сказать администратору.</p>
<h2>Хранение и передача</h2>
<p>Данные хранятся на сервере клуба и не передаются третьим лицам, кроме случаев, предусмотренных законом. Гость может попросить показать, исправить или удалить свои данные.</p>
<h2>Контакты</h2>
<p>По вопросам о данных: ${contact}.</p>
</body></html>`;
}
