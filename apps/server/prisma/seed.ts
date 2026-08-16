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

  // Настройки клуба обновляются при повторном сиде: иначе правка лимитов
  // в этом файле не доезжает до уже созданной базы и молча игнорируется.
  const clubSettings = {
    creditLimit: kzt(100),
    packageValidityDays: 30,
    lowBalanceWarnMinutes: 10,
    bonusPercent: 5,
  };

  const club = await prisma.club.upsert({
    where: { id: "seed-club" },
    update: clubSettings,
    create: {
      id: "seed-club",
      tenantId: tenant.id,
      name: "Cyber-Fox Центральный",
      city: "Алматы",
      timezone: "Asia/Almaty",
      ...clubSettings,
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

  /** Поля тарифа, которые задаёт сид. */
  interface TariffSeed {
    kind: TariffKind;
    pricePerMinute?: number;
    packageMinutes?: number;
    packagePrice?: number;
    fallbackTariffId?: string;
    activeFromMinute?: number;
    activeToMinute?: number;
  }

  /** Тарифы заводятся через upsert: повторный сид не должен плодить дубли. */
  const upsertTariff = (zoneId: string, name: string, data: TariffSeed) =>
    prisma.tariff.upsert({
      where: { clubId_zoneId_name: { clubId: club.id, zoneId, name } },
      update: data,
      create: { clubId: club.id, zoneId, name, ...data },
    });

  const standardMinute = await upsertTariff(standard.id, "Стандарт поминутно", {
    kind: TariffKind.PER_MINUTE,
    pricePerMinute: kzt(10),
  });

  const standardNight = await upsertTariff(standard.id, "Стандарт ночь", {
    kind: TariffKind.PER_MINUTE,
    pricePerMinute: kzt(5),
    // Ночное окно перебивает круглосуточный тариф с 22:00 до 08:00.
    activeFromMinute: 22 * 60,
    activeToMinute: 8 * 60,
  });

  const vipMinute = await upsertTariff(vip.id, "VIP поминутно", {
    kind: TariffKind.PER_MINUTE,
    pricePerMinute: kzt(20),
  });

  await prisma.zone.update({
    where: { id: standard.id },
    data: { defaultPerMinuteTariffId: standardMinute.id },
  });
  await prisma.zone.update({
    where: { id: vip.id },
    data: { defaultPerMinuteTariffId: vipMinute.id },
  });

  await upsertTariff(standard.id, "Пакет 3 часа Стандарт", {
    kind: TariffKind.PACKAGE,
    packageMinutes: 180,
    packagePrice: kzt(1500),
    fallbackTariffId: standardMinute.id,
  });

  await upsertTariff(vip.id, "Пакет 5 часов VIP", {
    kind: TariffKind.PACKAGE,
    packageMinutes: 300,
    packagePrice: kzt(5000),
    fallbackTariffId: vipMinute.id,
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

  // Бар: цена и себестоимость нужны, чтобы в отчёте по смене была маржа.
  const products = [
    { name: "Кола 0.5", category: "Напитки", price: kzt(600), cost: kzt(320), stock: 48 },
    { name: "Энергетик", category: "Напитки", price: kzt(900), cost: kzt(520), stock: 36 },
    { name: "Кофе", category: "Напитки", price: kzt(500), cost: kzt(150), stock: null },
    { name: "Чипсы", category: "Снеки", price: kzt(700), cost: kzt(400), stock: 24 },
    { name: "Шоколад", category: "Снеки", price: kzt(450), cost: kzt(260), stock: 30 },
    { name: "Лапша", category: "Еда", price: kzt(800), cost: kzt(420), stock: 20 },
  ];
  for (const product of products) {
    await prisma.product.upsert({
      where: { clubId_name: { clubId: club.id, name: product.name } },
      update: {},
      create: { clubId: club.id, ...product },
    });
  }

  // Второй зал: без него не проверить ни права управляющих, ни сводные отчёты,
  // ни межклубный взаимозачёт.
  const second = await prisma.club.upsert({
    where: { id: "seed-club-2" },
    update: clubSettings,
    create: {
      id: "seed-club-2",
      tenantId: tenant.id,
      name: "Cyber-Fox Южный",
      city: "Алматы",
      timezone: "Asia/Almaty",
      ...clubSettings,
    },
  });

  const secondZone = await prisma.zone.upsert({
    where: { clubId_name: { clubId: second.id, name: "Стандарт" } },
    update: {},
    create: { clubId: second.id, name: "Стандарт", sortOrder: 1 },
  });

  const secondMinute = await prisma.tariff.upsert({
    where: { clubId_zoneId_name: { clubId: second.id, zoneId: secondZone.id, name: "Стандарт поминутно" } },
    update: { pricePerMinute: kzt(8) },
    create: {
      clubId: second.id,
      zoneId: secondZone.id,
      name: "Стандарт поминутно",
      kind: TariffKind.PER_MINUTE,
      pricePerMinute: kzt(8),
    },
  });

  await prisma.zone.update({
    where: { id: secondZone.id },
    data: { defaultPerMinuteTariffId: secondMinute.id },
  });

  for (let i = 1; i <= 20; i++) {
    const name = `ПК-${String(i).padStart(2, "0")}`;
    await prisma.computer.upsert({
      where: { clubId_name: { clubId: second.id, name } },
      update: {},
      create: {
        clubId: second.id,
        zoneId: secondZone.id,
        name,
        pairingToken: `seed-pair-south-${i}`,
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

  await prisma.staff.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "south@cyberfox.kz" } },
    update: {},
    create: {
      tenantId: tenant.id,
      clubId: second.id,
      email: "south@cyberfox.kz",
      fullName: "Управляющий Южного",
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
  console.log(`  Товаров в баре: ${products.length}, бонусы ${club.bonusPercent}%`);
  console.log(`  Второй зал: ${second.name} (${second.id}), 20 машин, 8 ₸/мин`);
  console.log("  Управляющий второго зала: south@cyberfox.kz");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
