import type { StaffRole } from "@prisma/client";

/**
 * Содержимое JWT. Здесь же лежит разграничение доступа: tenantId отделяет сети
 * друг от друга, clubId — залы внутри сети. У владельца clubId пуст: он видит всё.
 */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  clubId: string | null;
  role: StaffRole;
  /** Версия токена: не совпала с той, что в базе — токен больше не годен. */
  ver: number;
}

export interface AuthenticatedStaff {
  id: string;
  tenantId: string;
  clubId: string | null;
  role: StaffRole;
}

declare module "express" {
  interface Request {
    staff?: AuthenticatedStaff;
  }
}
