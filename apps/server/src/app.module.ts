import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AuthModule } from "./auth/auth.module.js";
import { SubscriptionModule } from "./billing-platform/subscription.module.js";
import { JwtAuthGuard, RolesGuard } from "./auth/guards.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { GuestsModule } from "./guests/guests.module.js";
import { ImportModule } from "./import/import.module.js";
import { LibraryModule } from "./library/library.module.js";
import { NetworkModule } from "./network/network.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ProductsModule } from "./products/products.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { ShiftsModule } from "./shifts/shifts.module.js";
import { SignupModule } from "./signup/signup.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    /*
     * Ограничение частоты запросов. Пароль сотрудника подбирался бы бесконечно,
     * в том числе из локальной сети клуба, где касса открыта каждому, кто
     * подключился к вайфаю. Общий предел щедрый — кассовый экран шлёт много
     * мелких запросов; жёсткий стоит отдельно на входе.
     */
    ThrottlerModule.forRoot([
      { name: "общий", ttl: 60_000, limit: 300 },
      { name: "вход", ttl: 60_000, limit: 5 },
    ]),
    PrismaModule,
    SubscriptionModule,
    AuthModule,
    CatalogModule,
    GuestsModule,
    SessionsModule,
    ShiftsModule,
    ProductsModule,
    LibraryModule,
    NetworkModule,
    ReportsModule,
    SignupModule,
    ImportModule,
    PaymentsModule,
    RealtimeModule,
  ],
  providers: [
    // Закрыто по умолчанию: публичные точки помечаются явно декоратором @Public.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
