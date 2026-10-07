-- Афиша ивентов на экране блокировки и лозунг сети.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "slogan" TEXT NOT NULL DEFAULT 'территория эпичных побед';

-- CreateTable
CREATE TABLE "ClubEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "prize" TEXT,
    "fee" TEXT,
    "seats" TEXT,
    "howToJoin" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubEvent_tenantId_startsAt_idx" ON "ClubEvent"("tenantId", "startsAt");

-- AddForeignKey
ALTER TABLE "ClubEvent" ADD CONSTRAINT "ClubEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubEvent" ADD CONSTRAINT "ClubEvent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Изоляция сетей, как у остальных таблиц (20260818160000_tenant_isolation).
ALTER TABLE "ClubEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClubEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClubEvent"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());
