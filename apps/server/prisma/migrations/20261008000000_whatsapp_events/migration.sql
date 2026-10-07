-- WhatsApp через Green-API, подтверждение номера гостя и ивенты с приглашениями по сети.

-- CreateEnum
CREATE TYPE "EventAudience" AS ENUM ('NETWORK', 'CLUB');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'GOING', 'DECLINED');

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN "invitesOptOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL DEFAULT 'https://api.green-api.com',
    "instanceId" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "lastState" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneVerification" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "audience" "EventAudience" NOT NULL DEFAULT 'NETWORK',
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "PhoneVerification_guestId_createdAt_idx" ON "PhoneVerification"("guestId", "createdAt");
CREATE INDEX "Event_tenantId_startsAt_idx" ON "Event"("tenantId", "startsAt");
CREATE INDEX "Event_clubId_startsAt_idx" ON "Event"("clubId", "startsAt");
CREATE UNIQUE INDEX "EventInvite_eventId_guestId_key" ON "EventInvite"("eventId", "guestId");
CREATE INDEX "EventInvite_status_createdAt_idx" ON "EventInvite"("status", "createdAt");
CREATE INDEX "EventInvite_guestId_sentAt_idx" ON "EventInvite"("guestId", "sentAt");

-- AddForeignKey
ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhoneVerification" ADD CONSTRAINT "PhoneVerification_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц
-- (см. 20260818160000_tenant_isolation).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsAppChannel', 'Event']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
       WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())', t);
  END LOOP;
END $$;

-- Код подтверждения принадлежит гостю: сеть достаётся через него.
ALTER TABLE "PhoneVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhoneVerification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhoneVerification"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Guest" g WHERE g.id = "PhoneVerification"."guestId" AND g."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Guest" g WHERE g.id = "PhoneVerification"."guestId" AND g."tenantId" = cyberfox_tenant())
  );

-- Приглашение принадлежит ивенту.
ALTER TABLE "EventInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EventInvite"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Event" e WHERE e.id = "EventInvite"."eventId" AND e."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Event" e WHERE e.id = "EventInvite"."eventId" AND e."tenantId" = cyberfox_tenant())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsAppChannel", "PhoneVerification", "Event", "EventInvite" TO cyberfox_app;
