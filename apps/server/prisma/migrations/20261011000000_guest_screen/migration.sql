-- Экран блокировки: слоган клуба и карусель с турнирами и рекламой партнёров.

-- AlterTable
ALTER TABLE "Club" ADD COLUMN "slogan" TEXT;

-- CreateTable
CREATE TABLE "ScreenSlide" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "partner" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenSlide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreenSlide_tenantId_idx" ON "ScreenSlide"("tenantId");
CREATE INDEX "ScreenSlide_clubId_idx" ON "ScreenSlide"("clubId");

-- AddForeignKey
ALTER TABLE "ScreenSlide" ADD CONSTRAINT "ScreenSlide_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreenSlide" ADD CONSTRAINT "ScreenSlide_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "ScreenSlide" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScreenSlide" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScreenSlide"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "ScreenSlide" TO cyberfox_app;
