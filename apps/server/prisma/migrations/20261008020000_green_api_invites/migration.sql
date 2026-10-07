-- WhatsApp через Green-API вместо WhatsApp Cloud API и приглашения на ивенты афиши.

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'GOING', 'DECLINED');

-- AlterTable
ALTER TABLE "ClubEvent" ADD COLUMN "invitesSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL DEFAULT 'https://api.green-api.com',
    "instanceId" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "phone" TEXT,
    "lastState" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastIncomingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInvite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppChannel_tenantId_key" ON "WhatsAppChannel"("tenantId");
CREATE UNIQUE INDEX "WhatsAppChannel_instanceId_key" ON "WhatsAppChannel"("instanceId");
CREATE UNIQUE INDEX "WhatsAppChannel_webhookToken_key" ON "WhatsAppChannel"("webhookToken");
CREATE UNIQUE INDEX "EventInvite_eventId_guestId_key" ON "EventInvite"("eventId", "guestId");
CREATE INDEX "EventInvite_status_createdAt_idx" ON "EventInvite"("status", "createdAt");
CREATE INDEX "EventInvite_guestId_sentAt_idx" ON "EventInvite"("guestId", "sentAt");

-- AddForeignKey
ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ClubEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "WhatsAppChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppChannel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsAppChannel"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

-- Приглашение принадлежит ивенту афиши.
ALTER TABLE "EventInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EventInvite"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "ClubEvent" e WHERE e.id = "EventInvite"."eventId" AND e."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "ClubEvent" e WHERE e.id = "EventInvite"."eventId" AND e."tenantId" = cyberfox_tenant())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsAppChannel", "EventInvite" TO cyberfox_app;
