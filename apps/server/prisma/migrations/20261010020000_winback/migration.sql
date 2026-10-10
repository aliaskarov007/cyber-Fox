-- Отток гостей: личные промокоды ушедшим гостям через WhatsApp.

-- CreateEnum
CREATE TYPE "WinbackStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN "guestId" TEXT;

-- CreateTable
CREATE TABLE "WinbackCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "createdById" TEXT,
    "kind" "PromoKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "validDays" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WinbackCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WinbackMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "status" "WinbackStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WinbackMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoCode_guestId_idx" ON "PromoCode"("guestId");
CREATE INDEX "WinbackCampaign_clubId_createdAt_idx" ON "WinbackCampaign"("clubId", "createdAt");
CREATE UNIQUE INDEX "WinbackMessage_promoId_key" ON "WinbackMessage"("promoId");
CREATE UNIQUE INDEX "WinbackMessage_campaignId_guestId_key" ON "WinbackMessage"("campaignId", "guestId");
CREATE INDEX "WinbackMessage_status_createdAt_idx" ON "WinbackMessage"("status", "createdAt");
CREATE INDEX "WinbackMessage_guestId_sentAt_idx" ON "WinbackMessage"("guestId", "sentAt");

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackCampaign" ADD CONSTRAINT "WinbackCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackCampaign" ADD CONSTRAINT "WinbackCampaign_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackMessage" ADD CONSTRAINT "WinbackMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WinbackCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackMessage" ADD CONSTRAINT "WinbackMessage_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackMessage" ADD CONSTRAINT "WinbackMessage_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей. У сообщения своей сети нет — оно видно через рассылку.
ALTER TABLE "WinbackCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WinbackCampaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WinbackCampaign"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

ALTER TABLE "WinbackMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WinbackMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WinbackMessage"
  USING (cyberfox_tenant() IS NULL OR EXISTS (
    SELECT 1 FROM "WinbackCampaign" c WHERE c."id" = "WinbackMessage"."campaignId" AND c."tenantId" = cyberfox_tenant()))
  WITH CHECK (cyberfox_tenant() IS NULL OR EXISTS (
    SELECT 1 FROM "WinbackCampaign" c WHERE c."id" = "WinbackMessage"."campaignId" AND c."tenantId" = cyberfox_tenant()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "WinbackCampaign" TO cyberfox_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WinbackMessage" TO cyberfox_app;
