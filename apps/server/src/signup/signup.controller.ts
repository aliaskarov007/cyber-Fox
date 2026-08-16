import { Body, Controller, Post } from "@nestjs/common";

import { Public } from "../auth/guards.js";
import { SignupDto } from "./signup.dto.js";
import { SignupService } from "./signup.service.js";

@Controller("signup")
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  /** Публичная точка: чужой владелец регистрируется без нашего участия. */
  @Public()
  @Post()
  register(@Body() dto: SignupDto) {
    return this.signup.signup(dto);
  }
}
