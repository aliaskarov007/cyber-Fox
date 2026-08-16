import { Global, Module } from "@nestjs/common";

import { SubscriptionController } from "./subscription.controller.js";
import { SubscriptionService } from "./subscription.service.js";

/**
 * Глобальный: проверку подписки делают и сессии, и каталог машин,
 * и тащить модуль в каждый из них было бы шумом.
 */
@Global()
@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
