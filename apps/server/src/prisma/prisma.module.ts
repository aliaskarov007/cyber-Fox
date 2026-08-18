import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { PrismaService } from "./prisma.service.js";
import { TenantScopeInterceptor } from "./tenant-scope.interceptor.js";

@Global()
@Module({
  providers: [
    PrismaService,
    // Перехватчик общий: изоляция не должна зависеть от того, вспомнил ли о ней
    // автор нового модуля.
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
