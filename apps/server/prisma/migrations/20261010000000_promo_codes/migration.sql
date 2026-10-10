-- Промокоды: деньги на счёт гостя или бонусные баллы.

-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('BALANCE', 'BONUS');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PROMO';

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdById" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "staffId" TEXT,
    "computerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_tenantId_code_key" ON "PromoCode"("tenantId", "code");
CREATE INDEX "PromoCode_clubId_idx" ON "PromoCode"("clubId");
CREATE UNIQUE INDEX "PromoRedemption_promoId_guestId_key" ON "PromoRedemption"("promoId", "guestId");
CREATE INDEX "PromoRedemption_guestId_idx" ON "PromoRedemption"("guestId");

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "PromoCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromoCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PromoCode"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

ALTER TABLE "PromoRedemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromoRedemption" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PromoRedemption"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "PromoCode" TO cyberfox_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PromoRedemption" TO cyberfox_app;
