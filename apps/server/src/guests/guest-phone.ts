import type { Guest } from "@prisma/client";

import type { PrismaService } from "../prisma/prisma.service.js";
import { normalizePhone, samePhone } from "../whatsapp/whatsapp.rules.js";

/**
 * Гость сети по номеру, как бы этот номер ни был записан.
 *
 * На стойке номер вводят как придётся — «8 701…», «+7 (701)…», — и точное
 * сравнение строк не находит гостя, который набрал его иначе. Сначала ищем
 * точное совпадение, потом сужаем по двум последним цифрам (их почти никогда
 * не разделяют пробелом) и сравниваем нормализованные номера.
 *
 * Если у номера несколько карточек, предпочитаем подтверждённую: этот гость
 * доказал, что номер его.
 */
export async function findGuestByPhone(
  prisma: PrismaService,
  tenantId: string,
  phone: string,
): Promise<Guest | null> {
  const exact = await prisma.guest.findUnique({
    where: { tenantId_phone: { tenantId, phone: phone.trim() } },
  });
  if (exact) return exact;

  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const candidates = await prisma.guest.findMany({
    where: { tenantId, phone: { contains: normalized.slice(-2) } },
  });
  const matches = candidates.filter((c) => samePhone(c.phone, normalized));
  return matches.find((c) => c.phoneVerifiedAt !== null) ?? matches[0] ?? null;
}

/** Как хранить номер, заведённый самим гостем: единый вид с плюсом. */
export function storedPhone(normalized: string): string {
  return `+${normalized}`;
}
