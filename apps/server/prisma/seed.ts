import { PrismaClient, StaffRole, TariffKind } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** ₸ → тиын. Все суммы в базе целые, см. docs/billing.md. */
const kzt = (amount: number): number => Math.round(amount * 100);

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { id: "seed-tenant" },
    update: {},
    create: {
      id: "seed-tenant",
      name: "Cyber-Fox",
      // Общий кошелёк выключен по умолчанию: включается осознанно, вместе с
      // отчётом по межклубному взаимозачёту.
      sharedBalance: false,
    },
  });

  const club = await prisma.club.upsert({
    where: { id: "seed-club" },
    update: {},
    create: {
      id: "seed-club",
      tenantId: tenant.id,
      name: "Cyber-Fox Центральный",
      city: "Алматы",
      timezone: "Asia/Almaty",
      creditLimit: kzt(100),
      packageValidityDays: 30,
      lowBalanceWarnMinutes: 10,
    },
  });

  const standard = await prisma.zone.upsert({
    where: { clubId_name: { clubId: club.id, name: "Стандарт" } },
    update: {},
    create: { clubId: club.id, name: "Стандарт", sortOrder: 1 },
  });

  const vip = await prisma.zone.upsert({
    where: { clubId_name: { clubId: club.id, name: "VIP" } },
    update: {},
    create: { clubId: club.id, name: "VIP", sortOrder: 2 },
  });

  const standardMinute = await prisma.tariff.create({
    data: {
      clubId: club.id,
      zoneId: standard.id,
      name: "Стандарт поминутно",
      kind: TariffKind.PER_MINUTE,
      pricePerMinute: kzt(10),
    },
  });

  const standardNight = await prisma.tariff.create({
    data: {
      clubId: club.id,
      zoneId: standard.id,
      name: "Стандарт ночь",
      kind: TariffKind.PER_MINUTE,
      pricePerMinute: kzt(5),
      // Ночное окно перебивает круглосуточный тариф с 22:00 до 08:00.
      activeFromMinute: 22 * 60,
      activeToMinute: 8 * 60,
    },
  });

  const vipMinute = await prisma.tariff.create({
    data: {
      clubId: club.id,
      zoneId: vip.id,
      name: "VIP поминутно",
      kind: TariffKind.PER_MINUTE,
      pricePerMinute: kzt(20),
    },
  });

  await prisma.zone.update({
    where: { id: standard.id },
    data: { defaultPerMinuteTariffId: standardMinute.id },
  });
  await prisma.zone.update({
    where: { id: vip.id },
    data: { defaultPerMinuteTariffId: vipMinute.id },
  });

  await prisma.tariff.create({
    data: {
      clubId: club.id,
      zoneId: standard.id,
      name: "Пакет 3 часа Стандарт",
      kind: TariffKind.PACKAGE,
      packageMinutes: 180,
      packagePrice: kzt(1500),
      fallbackTariffId: standardMinute.id,
    },
  });

  await prisma.tariff.create({
    data: {
      clubId: club.id,
      zoneId: vip.id,
      name: "Пакет 5 часов VIP",
      kind: TariffKind.PACKAGE,
      packageMinutes: 300,
      packagePrice: kzt(5000),
      fallbackTariffId: vipMinute.id,
    },
  });

  // Зал: 40 машин Стандарт и 10 VIP — типичный размер по итогам обсуждения.
  for (let i = 1; i <= 40; i++) {
    const name = `ПК-${String(i).padStart(2, "0")}`;
    await prisma.computer.upsert({
      where: { clubId_name: { clubId: club.id, name } },
      update: {},
      create: {
        clubId: club.id,
        zoneId: standard.id,
        name,
        pairingToken: `seed-pair-std-${i}`,
      },
    });
  }
  for (let i = 1; i <= 10; i++) {
    const name = `VIP-${String(i).padStart(2, "0")}`;
    await prisma.computer.upsert({
      where: { clubId_name: { clubId: club.id, name } },
      update: {},
      create: {
        clubId: club.id,
        zoneId: vip.id,
        name,
        pairingToken: `seed-pair-vip-${i}`,
      },
    });
  }

  const passwordHash = await bcrypt.hash("cyberfox123", 10);
  await prisma.staff.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "owner@cyberfox.kz" } },
    update: {},
    create: {
      tenantId: tenant.id,
      clubId: null, // Владелец сети видит все залы.
      email: "owner@cyberfox.kz",
      fullName: "Владелец сети",
      passwordHash,
      role: StaffRole.OWNER,
    },
  });
  await prisma.staff.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@cyberfox.kz" } },
    update: {},
    create: {
      tenantId: tenant.id,
      clubId: club.id,
      email: "admin@cyberfox.kz",
      fullName: "Администратор зала",
      passwordHash,
      role: StaffRole.ADMIN,
    },
  });

  const guest = await prisma.guest.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone: "+77010000001" } },
    update: {},
    create: {
      tenantId: tenant.id,
      fullName: "Айдос",
      phone: "+77010000001",
      pinHash: await bcrypt.hash("1234", 10),
    },
  });

  const wallet = await prisma.guestWallet.findFirst({
    where: { guestId: guest.id, clubId: club.id },
  });
  if (!wallet) {
    await prisma.guestWallet.create({
      data: { guestId: guest.id, clubId: club.id, balance: kzt(2000) },
    });
  }

  console.log("Сид готов.");
  console.log(`  Клуб: ${club.name} (${club.id})`);
  console.log("  Вход: owner@cyberfox.kz / admin@cyberfox.kz, пароль cyberfox123");
  console.log("  Гость: +77010000001, PIN 1234, баланс 2000 ₸");
  console.log(`  Ночной тариф: ${standardNight.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
