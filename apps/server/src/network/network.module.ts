import { Module } from "@nestjs/common";

import { NetworkController } from "./network.controller.js";
import { NetworkService } from "./network.service.js";

@Module({
  controllers: [NetworkController],
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworkModule {}
