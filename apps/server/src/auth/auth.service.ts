import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { StaffRole } from "@prisma/client";
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
    const passwordOk = staff
      ? await bcrypt.compare(password, staff.passwordHash)
      : false;
    if (!staff || !passwordOk) {
      throw new UnauthorizedException("Неверный адрес или пароль");
    }

    return this.issue(staff);
  }

  /**
   * Быстрый вход кассира по ПИН на кассовом ПК. ПИН проверяется по конкретному
   * сотруднику (его выбирают из списка), а не по почте — быстрее на пересменке.
   */
  async pinLogin(staffId: string, pin: string): Promise<LoginResult> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, isActive: true },
    });
    const pinOk =
      staff && staff.pinHash ? await bcrypt.compare(pin, staff.pinHash) : false;
    if (!staff || !pinOk) {
      throw new UnauthorizedException("Неверный ПИН");
    }
    return this.issue(staff);
  }

  /** Кассиры клуба с заданным ПИН — для быстрого входа на кассовом ПК. */
  async cashiers(
    clubId: string,
  ): Promise<Array<{ id: string; fullName: string; role: string }>> {
    const list = await this.prisma.staff.findMany({
      where: { clubId, isActive: true, pinHash: { not: null } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    });
    return list;
  }

  /** Сотрудник задаёт себе 4-значный ПИН для быстрого входа. */
  async setPin(staffId: string, pin: string): Promise<void> {
    if (!/^\d{4}$/.test(pin)) {
      throw new UnauthorizedException("ПИН — четыре цифры");
    }
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { pinHash: await bcrypt.hash(pin, 10) },
    });
  }

  private async issue(staff: {
    id: string;
    tenantId: string;
    clubId: string | null;
    email: string;
    fullName: string;
    role: StaffRole;
    tokenVersion: number;
  }): Promise<LoginResult> {
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
