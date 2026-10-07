-- Регистрация гостя за игровым ПК: QR → сообщение с кодом в WhatsApp клуба.

-- CreateEnum
CREATE TYPE "GuestSignupStatus" AS ENUM ('WAITING', 'CONFIRMED', 'COMPLETED');

-- AlterTable
ALTER TABLE "WhatsAppChannel" ADD COLUMN "phone" TEXT;

-- CreateTable
CREATE TABLE "GuestSignup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "GuestSignupStatus" NOT NULL DEFAULT 'WAITING',
    "phone" TEXT,
    "guestId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestSignup_code_key" ON "GuestSignup"("code");
CREATE INDEX "GuestSignup_computerId_createdAt_idx" ON "GuestSignup"("computerId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestSignup" ADD CONSTRAINT "GuestSignup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "GuestSignup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestSignup" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GuestSignup"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "GuestSignup" TO cyberfox_app;
