import { Module } from "@nestjs/common";

import { SessionsModule } from "../sessions/sessions.module.js";
import { AfishaController } from "./afisha.controller.js";
import { AfishaService } from "./afisha.service.js";

// Шина — из SessionsModule, как у каталога игр: своя шина шлюзу не слышна.
@Module({
  imports: [SessionsModule],
  controllers: [AfishaController],
  providers: [AfishaService],
  exports: [AfishaService],
})
export class AfishaModule {}
