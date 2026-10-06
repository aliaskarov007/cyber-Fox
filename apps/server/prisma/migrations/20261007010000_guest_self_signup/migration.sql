-- Регистрация гостя с игрового ПК: подтверждение номера через WhatsApp,
-- согласие на приглашения и подарок за него.

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('AGENT', 'DESK');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "consentBonus" INTEGER NOT NULL DEFAULT 50000;

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "consentBonusGrantedAt" TIMESTAMP(3),
ADD COLUMN     "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN     "marketingConsentSource" "ConsentSource",
ADD COLUMN     "marketingConsentText" TEXT,
ADD COLUMN     "marketingOptOutAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "registeredClubId" TEXT;

-- Всех, кто есть сейчас, заводил администратор, видя гостя перед собой: их
-- номера считаются подтверждёнными, иначе любой забрал бы их с игрового ПК.
UPDATE "Guest" SET "phoneVerifiedAt" = "createdAt";

-- CreateTable
CREATE TABLE "PhoneVerification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "guestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneVerification_phone_code_idx" ON "PhoneVerification"("phone", "code");

-- CreateIndex
CREATE INDEX "PhoneVerification_computerId_createdAt_idx" ON "PhoneVerification"("computerId", "createdAt");

-- CreateIndex
CREATE INDEX "PhoneVerification_tenantId_idx" ON "PhoneVerification"("tenantId");

-- AddForeignKey
ALTER TABLE "PhoneVerification" ADD CONSTRAINT "PhoneVerification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей, как у остальных таблиц (20260818160000_tenant_isolation).
-- Входящее сообщение WhatsApp обрабатывается без сети в настройке и видит все
-- ожидающие подтверждения — так и задумано: из сообщения сеть не узнать.
ALTER TABLE "PhoneVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhoneVerification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhoneVerification"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());
