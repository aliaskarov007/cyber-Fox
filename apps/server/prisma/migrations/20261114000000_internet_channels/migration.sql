-- Интернет-каналы клуба: подключение к роутеру и список каналов (провайдеров).

CREATE TABLE "InternetRouter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "apiPort" INTEGER NOT NULL DEFAULT 0,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "driver" TEXT NOT NULL DEFAULT 'ROS7',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowMidSession" BOOLEAN NOT NULL DEFAULT true,
    "lastState" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InternetRouter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InternetRouter_clubId_key" ON "InternetRouter"("clubId");
CREATE INDEX "InternetRouter_tenantId_idx" ON "InternetRouter"("tenantId");

CREATE TABLE "InternetChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "routerMark" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InternetChannel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InternetChannel_clubId_idx" ON "InternetChannel"("clubId");
CREATE INDEX "InternetChannel_tenantId_idx" ON "InternetChannel"("tenantId");

ALTER TABLE "InternetRouter" ADD CONSTRAINT "InternetRouter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternetRouter" ADD CONSTRAINT "InternetRouter_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternetChannel" ADD CONSTRAINT "InternetChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternetChannel" ADD CONSTRAINT "InternetChannel_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция арендатора, как у остальных таблиц.
ALTER TABLE "InternetRouter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InternetRouter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InternetRouter"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

ALTER TABLE "InternetChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InternetChannel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InternetChannel"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());
