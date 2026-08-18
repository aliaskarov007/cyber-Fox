import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { type Club, StaffRole, type Tenant, TransactionType } from "@prisma/client";
import bcrypt from "bcryptjs";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  CreateClubDto,
  CreateStaffDto,
  UpdateClubDto,
  UpdateStaffDto,
  UpdateTenantDto,
} from "./network.dto.js";

export interface PublicStaff {
  id: string;
  clubId: string | null;
  email: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
}

/**
 * Управление сетью: клубы, сотрудники, настройки владельца.
 *
 * Всё здесь доступно только владельцу сети: управляющий заведует своим залом,
 * но не заводит новые и не назначает себе роли.
 */
@Injectable()
export class NetworkService {
  constructor(private readonly prisma: PrismaService) {}

  async tenant(staff: AuthenticatedStaff): Promise<Tenant> {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id: staff.tenantId } });
  }

  async createClub(staff: AuthenticatedStaff, dto: CreateClubDto): Promise<Club> {
    this.requireOwner(staff);
    return this.prisma.club.create({
      data: {
        tenantId: staff.tenantId,
        name: dto.name.trim(),
        city: dto.city ?? null,
        timezone: dto.timezone ?? "Asia/Almaty",
      },
    });
  }

  async updateClub(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: UpdateClubDto,
  ): Promise<Club> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club || club.tenantId !== staff.tenantId) throw new NotFoundException("Клуб не найден");

    // Управляющий настраивает свой зал; чужой — только владелец сети.
    if (staff.role !== StaffRole.OWNER && staff.clubId !== clubId) {
      throw new ForbiddenException("Нет доступа к этому клубу");
    }
    if (staff.role === StaffRole.STAFF) {
      throw new ForbiddenException("Настройки клуба меняет управляющий или владелец");
    }

    return this.prisma.club.update({ where: { id: clubId }, data: dto });
  }

  async listStaff(staff: AuthenticatedStaff): Promise<PublicStaff[]> {
    const people = await this.prisma.staff.findMany({
      where: {
        tenantId: staff.tenantId,
        // Управляющий видит только своих сотрудников.
        ...(staff.role === StaffRole.OWNER ? {} : { clubId: staff.clubId }),
      },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    });

    return people.map(toPublicStaff);
  }

  async createStaff(staff: AuthenticatedStaff, dto: CreateStaffDto): Promise<PublicStaff> {
    this.requireOwner(staff);
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.staff.findUnique({
      where: { tenantId_email: { tenantId: staff.tenantId, email } },
    });
    if (existing) throw new BadRequestException("Сотрудник с таким адресом уже есть");

    if (dto.clubId) await this.requireOwnClub(staff.tenantId, dto.clubId);
    // Владелец сети не привязан к залу: пустой clubId открывает ему всю сеть.
    if (dto.role !== StaffRole.OWNER && !dto.clubId) {
      throw new BadRequestException("Управляющему и администратору нужен клуб");
    }

    const created = await this.prisma.staff.create({
      data: {
        tenantId: staff.tenantId,
        clubId: dto.role === StaffRole.OWNER ? null : dto.clubId!,
        email,
        fullName: dto.fullName.trim(),
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role,
      },
    });

    return toPublicStaff(created);
  }

  async updateStaff(
    staff: AuthenticatedStaff,
    staffId: string,
    dto: UpdateStaffDto,
  ): Promise<PublicStaff> {
    this.requireOwner(staff);
    const target = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!target || target.tenantId !== staff.tenantId) {
      throw new NotFoundException("Сотрудник не найден");
    }

    // Владелец не должен случайно разжаловать сам себя и потерять доступ к сети.
    if (target.id === staff.id && (dto.role !== undefined || dto.isActive === false)) {
      throw new BadRequestException("Нельзя изменить собственную роль или отключить себя");
    }

    if (dto.clubId) await this.requireOwnClub(staff.tenantId, dto.clubId);

    /*
     * Увольнение, смена пароля, роли или зала отзывают прежние токены. Иначе
     * уволенный сотрудник работал бы в кассе до конца срока токена — двенадцать
     * часов, — а смена роли применялась бы только после нового входа.
     */
    const revokes =
      dto.isActive === false ||
      dto.password !== undefined ||
      dto.role !== undefined ||
      dto.clubId !== undefined;

    return toPublicStaff(
      await this.prisma.staff.update({
        where: { id: staffId },
        data: {
          fullName: dto.fullName,
          role: dto.role,
          isActive: dto.isActive,
          clubId: dto.role === StaffRole.OWNER ? null : dto.clubId,
          ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
          ...(revokes ? { tokenVersion: { increment: 1 } } : {}),
        },
      }),
    );
  }

  /**
   * Настройки сети. Переключение общего кошелька меняет структуру денег,
   * поэтому выполняется явно и пишется в журнал операций.
   */
  async updateTenant(staff: AuthenticatedStaff, dto: UpdateTenantDto): Promise<Tenant> {
    this.requireOwner(staff);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: staff.tenantId } });

    if (dto.sharedBalance === undefined || dto.sharedBalance === tenant.sharedBalance) {
      return this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { name: dto.name },
      });
    }

    return dto.sharedBalance
      ? this.mergeWallets(tenant.id, dto.name)
      : this.splitWallets(tenant.id, dto.moveBalancesToClubId, dto.name);
  }

  /** Включение общего кошелька: клубные кошельки складываются в один. */
  private async mergeWallets(tenantId: string, name?: string): Promise<Tenant> {
    return this.prisma.$transaction(async (tx) => {
      const guests = await tx.guest.findMany({
        where: { tenantId },
        include: { wallets: true },
      });

      for (const guest of guests) {
        const total = guest.wallets.reduce((sum, w) => sum + w.balance, 0);
        const shared = guest.wallets.find((w) => w.clubId === null);

        if (shared) {
          await tx.guestWallet.update({
            where: { id: shared.id },
            data: { balance: total },
          });
        } else {
          await tx.guestWallet.create({
            data: { guestId: guest.id, clubId: null, balance: total },
          });
        }

        // Клубные кошельки обнуляются, а не удаляются: на них ссылается история
        // операций, и терять её при смене настройки нельзя.
        for (const wallet of guest.wallets.filter((w) => w.clubId !== null)) {
          if (wallet.balance === 0) continue;
          await tx.transaction.create({
            data: {
              walletId: wallet.id,
              clubId: wallet.clubId!,
              type: TransactionType.ADJUSTMENT,
              amount: -wallet.balance,
              balanceAfter: 0,
              comment: "Перенос в общий кошелёк сети",
            },
          });
          await tx.guestWallet.update({ where: { id: wallet.id }, data: { balance: 0 } });
        }
      }

      return tx.tenant.update({
        where: { id: tenantId },
        data: { sharedBalance: true, name },
      });
    });
  }

  /**
   * Выключение общего кошелька. Разделить остаток по клубам корректно нельзя —
   * система не знает, чьи это деньги, поэтому клуб-получатель указывает владелец.
   */
  private async splitWallets(
    tenantId: string,
    targetClubId: string | undefined,
    name?: string,
  ): Promise<Tenant> {
    if (!targetClubId) {
      throw new BadRequestException(
        "Укажите клуб, куда перенести остатки: разделить общий кошелёк по залам автоматически нельзя",
      );
    }
    await this.requireOwnClub(tenantId, targetClubId);

    return this.prisma.$transaction(async (tx) => {
      const shared = await tx.guestWallet.findMany({
        where: { clubId: null, guest: { tenantId } },
      });

      for (const wallet of shared) {
        if (wallet.balance !== 0) {
          const existing = await tx.guestWallet.findFirst({
            where: { guestId: wallet.guestId, clubId: targetClubId },
          });
          const target =
            existing ??
            (await tx.guestWallet.create({
              data: { guestId: wallet.guestId, clubId: targetClubId, balance: 0 },
            }));

          const balanceAfter = target.balance + wallet.balance;
          await tx.guestWallet.update({
            where: { id: target.id },
            data: { balance: balanceAfter },
          });
          await tx.transaction.create({
            data: {
              walletId: target.id,
              clubId: targetClubId,
              type: TransactionType.ADJUSTMENT,
              amount: wallet.balance,
              balanceAfter,
              comment: "Перенос из общего кошелька сети",
            },
          });
        }
        await tx.guestWallet.update({ where: { id: wallet.id }, data: { balance: 0 } });
      }

      return tx.tenant.update({
        where: { id: tenantId },
        data: { sharedBalance: false, name },
      });
    });
  }

  private requireOwner(staff: AuthenticatedStaff): void {
    if (staff.role !== StaffRole.OWNER) {
      throw new ForbiddenException("Доступно только владельцу сети");
    }
  }

  private async requireOwnClub(tenantId: string, clubId: string): Promise<void> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club || club.tenantId !== tenantId) throw new NotFoundException("Клуб не найден");
  }
}

/** Хеш пароля наружу не выходит. */
export function toPublicStaff(staff: {
  id: string;
  clubId: string | null;
  email: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
}): PublicStaff {
  return {
    id: staff.id,
    clubId: staff.clubId,
    email: staff.email,
    fullName: staff.fullName,
    role: staff.role,
    isActive: staff.isActive,
  };
}
