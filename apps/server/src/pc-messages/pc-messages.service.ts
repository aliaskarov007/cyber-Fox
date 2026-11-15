import { Injectable, NotFoundException } from "@nestjs/common";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeBus } from "../realtime/realtime.bus.js";
import type { SendPcMessageDto } from "./pc-messages.dto.js";

/**
 * Сообщение кассира/админа на экран игрового ПК — всплывашкой сверху.
 * Один ПК или все машины клуба. Доставка живая: ПК офлайн — просто не увидит.
 */
@Injectable()
export class PcMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly bus: RealtimeBus,
  ) {}

  async send(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: SendPcMessageDto,
  ): Promise<{ ok: boolean }> {
    await this.access.requireClub(staff, clubId);
    const text = dto.text.trim();
    if (!text) return { ok: false };

    // На конкретный ПК — проверяем, что он из этого клуба.
    if (dto.computerId) {
      const computer = await this.prisma.computer.findUnique({
        where: { id: dto.computerId },
        select: { clubId: true },
      });
      if (!computer || computer.clubId !== clubId)
        throw new NotFoundException("ПК не найден");
    }

    this.bus.emit("pc.message", {
      clubId,
      computerId: dto.computerId ?? null,
      text,
    });
    return { ok: true };
  }
}
