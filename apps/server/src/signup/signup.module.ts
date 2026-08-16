import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { AuthService } from "../auth/auth.service.js";
import { SignupController } from "./signup.controller.js";
import { SignupService } from "./signup.service.js";

@Module({
  imports: [AuthModule],
  controllers: [SignupController],
  providers: [SignupService, AuthService],
})
export class SignupModule {}
