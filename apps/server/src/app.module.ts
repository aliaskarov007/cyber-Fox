import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";

import { AuthModule } from "./auth/auth.module.js";
import { SubscriptionModule } from "./billing-platform/subscription.module.js";
import { JwtAuthGuard, RolesGuard } from "./auth/guards.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { GuestsModule } from "./guests/guests.module.js";
import { ImportModule } from "./import/import.module.js";
import { NetworkModule } from "./network/network.module.js";
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
    PrismaModule,
    SubscriptionModule,
    AuthModule,
    CatalogModule,
    GuestsModule,
    SessionsModule,
    ShiftsModule,
    ProductsModule,
    NetworkModule,
    ReportsModule,
    SignupModule,
    ImportModule,
    RealtimeModule,
  ],
  providers: [
    // Закрыто по умолчанию: публичные точки помечаются явно декоратором @Public.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
