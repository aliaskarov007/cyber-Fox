import { Module } from "@nestjs/common";

import { ClubAccessService } from "../common/club-access.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { LibraryController } from "./library.controller.js";
import { LibraryService } from "./library.service.js";

/*
 * Шина берётся из SessionsModule, а не заводится своя. Своя означала бы второй
 * EventEmitter: правка каталога поднимала бы событие, которого шлюз не слышит,
 * и зал узнавал бы о новой игре только после перезапуска агентов.
 */
@Module({
  imports: [SessionsModule],
  controllers: [LibraryController],
  providers: [LibraryService, ClubAccessService],
  exports: [LibraryService],
})
export class LibraryModule {}
