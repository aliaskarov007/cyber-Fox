-- План клуба: подписи (ресепшн, уборная, диваны) и перегородки на карте.

CREATE TYPE "MapObjectKind" AS ENUM ('LABEL', 'WALL');

CREATE TABLE "MapObject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "kind" "MapObjectKind" NOT NULL,
    "text" TEXT,
    "posX" INTEGER NOT NULL DEFAULT 0,
    "posY" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 2,
    "height" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MapObject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MapObject_clubId_idx" ON "MapObject"("clubId");

ALTER TABLE "MapObject" ADD CONSTRAINT "MapObject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MapObject" ADD CONSTRAINT "MapObject_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция арендатора, как у остальных таблиц.
ALTER TABLE "MapObject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MapObject" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MapObject"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());
