import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";

import { PrismaService } from "../prisma/prisma.service.js";
import type { JwtPayload } from "./auth.types.js";

export interface LoginResult {
  accessToken: string;
  staff: {
    id: string;
    tenantId: string;
    clubId: string | null;
    email: string;
    fullName: string;
    role: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const staff = await this.prisma.staff.findFirst({
      where: { email: email.toLowerCase().trim(), isActive: true },
    });

    // Одинаковый ответ на неизвестный адрес и неверный пароль: иначе форма входа
    // превращается в способ узнать, кто работает в клубе.
    const passwordOk = staff ? await bcrypt.compare(password, staff.passwordHash) : false;
    if (!staff || !passwordOk) {
      throw new UnauthorizedException("Неверный адрес или пароль");
    }

    const payload: JwtPayload = {
      sub: staff.id,
      tenantId: staff.tenantId,
      clubId: staff.clubId,
      role: staff.role,
      ver: staff.tokenVersion,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      staff: {
        id: staff.id,
        tenantId: staff.tenantId,
        clubId: staff.clubId,
        email: staff.email,
        fullName: staff.fullName,
        role: staff.role,
      },
    };
  }
}
