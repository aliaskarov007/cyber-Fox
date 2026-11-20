import { Injectable, NotFoundException } from "@nestjs/common";
import type { Expense } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateExpenseDto } from "./expenses.dto.js";

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
  ) {}

  async create(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateExpenseDto,
  ): Promise<Expense> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.expense.create({
      data: {
        clubId,
        category: dto.category,
        amount: dto.amount,
        spentAt: new Date(dto.spentAt),
        note: dto.note?.trim() || null,
        staffId: staff.id,
      },
    });
  }

  async list(
    staff: AuthenticatedStaff,
    clubId: string,
    from: Date,
    to: Date,
  ): Promise<Expense[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.expense.findMany({
      where: { clubId, spentAt: { gte: from, lte: to } },
      orderBy: { spentAt: "desc" },
    });
  }

  async remove(
    staff: AuthenticatedStaff,
    clubId: string,
    id: string,
  ): Promise<{ ok: true }> {
    await this.access.requireClub(staff, clubId);
    const existing = await this.prisma.expense.findFirst({
      where: { id, clubId },
    });
    if (!existing) throw new NotFoundException("Расход не найден");
    await this.prisma.expense.delete({ where: { id } });
    return { ok: true };
  }
}
