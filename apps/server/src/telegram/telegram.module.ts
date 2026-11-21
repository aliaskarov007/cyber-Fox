import { Global, Module } from "@nestjs/common";

import { TelegramService } from "./telegram.service.js";

/**
 * Глобальный модуль уведомлений: TelegramService внедряется в любой сервис,
 * которому есть о чём сообщить (пополнение, продажа, правка баланса и т.д.),
 * без лишней обвязки импортами.
 */
@Global()
@Module({
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
