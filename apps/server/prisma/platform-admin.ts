import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Завести или сменить пароль платформенной учётной записи.
 *
 * Первую заводить нечем: в кассе такого экрана нет и быть не должно — она
 * принадлежит клубам. Поэтому первый вход создаётся командой на сервере, где и
 * так есть доступ к базе.
 *
 *   docker compose exec server node -e "..."  — не годится: нужен bcrypt.
 *   pnpm --filter @cyberfox/server exec tsx prisma/platform-admin.ts <почта> <пароль> [имя]
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Нужны почта и пароль: platform-admin.ts <почта> <пароль> [имя]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Пароль короче восьми знаков — этот вход открывает все клубы сразу");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.platformAdmin.upsert({
    where: { email: email.toLowerCase().trim() },
    update: { passwordHash, isActive: true },
    create: { email: email.toLowerCase().trim(), passwordHash, fullName: name ?? "Платформа" },
  });

  console.log(`Готово: ${admin.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
