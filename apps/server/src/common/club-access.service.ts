import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Club } from "@prisma/client";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Единственное место, где решается, доступен ли клуб сотруднику.
 *
 * Разделение по сетям и клубам — то, что позже пустит в систему чужих владельцев,
 * поэтому проверка живёт здесь, а не повторяется в каждом контроллере: пропущенная
 * копия означала бы утечку данных соседнего клуба.
 */
@Injectable()
export class ClubAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireClub(staff: AuthenticatedStaff, clubId: string): Promise<Club> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });

    // Чужая сеть отвечает «не найдено», а не «запрещено»: существование клуба
    // соседнего владельца — тоже информация.
    if (!club || club.tenantId !== staff.tenantId) {
      throw new NotFoundException("Клуб не найден");
    }

    // Владелец сети видит все свои залы; остальные — только свой.
    if (staff.clubId !== null && staff.clubId !== clubId) {
      throw new ForbiddenException("Нет доступа к этому клубу");
    }

    return club;
  }

  /** Клубы, доступные сотруднику: все залы сети для владельца, иначе один. */
  async listAccessibleClubs(staff: AuthenticatedStaff): Promise<Club[]> {
    return this.prisma.club.findMany({
      where: {
        tenantId: staff.tenantId,
        ...(staff.clubId === null ? {} : { id: staff.clubId }),
      },
      orderBy: { name: "asc" },
    });
  }
}
