import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { type Computer, type Tariff, TariffKind, type Zone } from "@prisma/client";
import { randomBytes } from "node:crypto";

import type { AuthenticatedStaff } from "../auth/auth.types.js";
import { ClubAccessService } from "../common/club-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SubscriptionService } from "../billing-platform/subscription.service.js";
import type {
  CreateComputerDto,
  CreateTariffDto,
  CreateZoneDto,
  UpdateComputerDto,
  UpdateTariffDto,
  UpdateZoneDto,
} from "./catalog.dto.js";

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClubAccessService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // --- Зоны ---

  async listZones(staff: AuthenticatedStaff, clubId: string): Promise<Zone[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.zone.findMany({
      where: { clubId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async createZone(staff: AuthenticatedStaff, clubId: string, dto: CreateZoneDto): Promise<Zone> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.zone.create({
      data: { clubId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async updateZone(
    staff: AuthenticatedStaff,
    clubId: string,
    zoneId: string,
    dto: UpdateZoneDto,
  ): Promise<Zone> {
    await this.access.requireClub(staff, clubId);
    await this.requireZone(clubId, zoneId);

    if (dto.defaultPerMinuteTariffId) {
      const tariff = await this.prisma.tariff.findUnique({
        where: { id: dto.defaultPerMinuteTariffId },
      });
      if (!tariff || tariff.clubId !== clubId) {
        throw new NotFoundException("Тариф не найден");
      }
      // Зона переключается на поминутку именно этим тарифом, поэтому пакет тут
      // бессмысленен: сессия ушла бы в тупик вместо продолжения игры.
      if (tariff.kind !== TariffKind.PER_MINUTE) {
        throw new BadRequestException("Тариф по умолчанию должен быть поминутным");
      }
      if (tariff.zoneId !== zoneId) {
        throw new BadRequestException("Тариф принадлежит другой зоне");
      }
    }

    return this.prisma.zone.update({ where: { id: zoneId }, data: dto });
  }

  // --- Компьютеры ---

  async listComputers(staff: AuthenticatedStaff, clubId: string): Promise<Computer[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.computer.findMany({
      where: { clubId },
      orderBy: { name: "asc" },
    });
  }

  async createComputer(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateComputerDto,
  ): Promise<Computer> {
    await this.access.requireClub(staff, clubId);
    await this.requireZone(clubId, dto.zoneId);
    // Лимит машин — то, за что платит сеть, поэтому проверяем до создания.
    await this.subscriptions.assertCanAddComputer(staff.tenantId);

    return this.prisma.computer.create({
      data: {
        clubId,
        zoneId: dto.zoneId,
        name: dto.name,
        // Код привязки печатается один раз при установке агента на машину.
        pairingToken: randomBytes(16).toString("hex"),
      },
    });
  }

  async updateComputer(
    staff: AuthenticatedStaff,
    clubId: string,
    computerId: string,
    dto: UpdateComputerDto,
  ): Promise<Computer> {
    await this.access.requireClub(staff, clubId);
    const computer = await this.prisma.computer.findUnique({ where: { id: computerId } });
    if (!computer || computer.clubId !== clubId) throw new NotFoundException("ПК не найден");
    if (dto.zoneId) await this.requireZone(clubId, dto.zoneId);

    return this.prisma.computer.update({ where: { id: computerId }, data: dto });
  }

  // --- Тарифы ---

  async listTariffs(staff: AuthenticatedStaff, clubId: string): Promise<Tariff[]> {
    await this.access.requireClub(staff, clubId);
    return this.prisma.tariff.findMany({
      where: { clubId },
      orderBy: [{ zoneId: "asc" }, { name: "asc" }],
    });
  }

  async createTariff(
    staff: AuthenticatedStaff,
    clubId: string,
    dto: CreateTariffDto,
  ): Promise<Tariff> {
    const club = await this.access.requireClub(staff, clubId);
    await this.requireZone(clubId, dto.zoneId);
    this.validateTariff(dto, club.creditLimit);

    return this.prisma.tariff.create({
      data: {
        clubId,
        zoneId: dto.zoneId,
        name: dto.name,
        kind: dto.kind,
        pricePerMinute: dto.pricePerMinute ?? null,
        packageMinutes: dto.packageMinutes ?? null,
        packagePrice: dto.packagePrice ?? null,
        validityDays: dto.validityDays ?? null,
        fallbackTariffId: dto.fallbackTariffId ?? null,
        activeFromMinute: dto.activeFromMinute ?? null,
        activeToMinute: dto.activeToMinute ?? null,
        daysOfWeek: dto.daysOfWeek ?? [],
      },
    });
  }

  async updateTariff(
    staff: AuthenticatedStaff,
    clubId: string,
    tariffId: string,
    dto: UpdateTariffDto,
  ): Promise<Tariff> {
    const club = await this.access.requireClub(staff, clubId);
    const tariff = await this.prisma.tariff.findUnique({ where: { id: tariffId } });
    if (!tariff || tariff.clubId !== clubId) throw new NotFoundException("Тариф не найден");
    this.validateTariff(dto, club.creditLimit);

    return this.prisma.tariff.update({ where: { id: tariffId }, data: dto });
  }

  /**
   * Предупреждения, которые дешевле выдать при настройке, чем разбирать потом на стойке.
   */
  private validateTariff(dto: Partial<CreateTariffDto>, creditLimit: number): void {
    if (dto.kind === TariffKind.PER_MINUTE) {
      if (!dto.pricePerMinute) {
        throw new BadRequestException("Для поминутного тарифа нужна цена минуты");
      }
      // Если минута дороже кредита, режим долга не даёт ни одной минуты и сессия
      // закрывается сразу по исчерпании баланса (docs/billing.md, раздел 6).
      if (dto.pricePerMinute > creditLimit) {
        throw new BadRequestException(
          "Цена минуты больше кредитного лимита клуба: гость не сможет доиграть ни минуты в долг. " +
            "Поднимите лимит клуба или снизьте цену.",
        );
      }
    }

    if (dto.kind === TariffKind.PACKAGE) {
      if (!dto.packageMinutes || dto.packagePrice === undefined) {
        throw new BadRequestException("Для пакета нужны минуты и цена");
      }
    }

    const hasFrom = dto.activeFromMinute !== undefined && dto.activeFromMinute !== null;
    const hasTo = dto.activeToMinute !== undefined && dto.activeToMinute !== null;
    if (hasFrom !== hasTo) {
      throw new BadRequestException("Окно действия задаётся началом и концом сразу");
    }
  }

  private async requireZone(clubId: string, zoneId: string): Promise<Zone> {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.clubId !== clubId) throw new NotFoundException("Зона не найдена");
    return zone;
  }
}
