import { Injectable, NotFoundException } from "@nestjs/common";
import type { TopUpBonusTier } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class BonusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
  ) {}

  async list(
    staff: AuthenticatedStaff,
    clubId: string,
  ): Promise<TopUpBonusTier[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.topUpBonusTier.findMany({
      where: { clubId },
      orderBy: { minTopUp: "asc" },
    });
  }

  async create(
    staff: AuthenticatedStaff,
    clubId: string,
    minTopUp: number,
    bonus: number,
  ): Promise<TopUpBonusTier> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.topUpBonusTier.create({
      data: { clubId, minTopUp, bonus },
    });
  }

  async remove(
    staff: AuthenticatedStaff,
    clubId: string,
    id: string,
  ): Promise<{ ok: true }> {
    await this.access.requireClub(staff, clubId);
    const existing = await this.prisma.topUpBonusTier.findFirst({
      where: { id, clubId },
    });
    if (!existing) throw new NotFoundException("Порог не найден");
    await this.prisma.topUpBonusTier.delete({ where: { id } });
    return { ok: true };
  }
}
