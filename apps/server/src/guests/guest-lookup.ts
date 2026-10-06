import type { Guest, Prisma } from "@prisma/client";

import { normalizePhone } from "../common/phone.js";
import type { PrismaService } from "../prisma/prisma.service.js";

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Гость сети по номеру, в какой бы записи номер ни набрали.
 *
 * Новые номера хранятся в одном виде (+7XXXXXXXXXX), но гостей, заведённых до
 * этого, записывали как придётся. Поэтому сначала точное совпадение, а если его
 * нет — кандидаты с тем же окончанием, приведённые к общему виду.
 */
export async function findGuestByPhone(db: Db, tenantId: string, rawPhone: string): Promise<Guest | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const exact = await db.guest.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
  if (exact) return exact;

  const candidates = await db.guest.findMany({
    where: { tenantId, phone: { endsWith: phone.slice(-2) } },
    take: 500,
  });
  return candidates.find((g) => normalizePhone(g.phone) === phone) ?? null;
}
