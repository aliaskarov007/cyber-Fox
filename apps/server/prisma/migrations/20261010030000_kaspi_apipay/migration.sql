-- Kaspi Pay через ApiPay: автоматическое зачисление пополнений с игровых ПК.

-- CreateTable
CREATE TABLE "KaspiChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastState" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KaspiChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KaspiChannel_tenantId_key" ON "KaspiChannel"("tenantId");
CREATE UNIQUE INDEX "KaspiChannel_webhookToken_key" ON "KaspiChannel"("webhookToken");

-- AddForeignKey
ALTER TABLE "KaspiChannel" ADD CONSTRAINT "KaspiChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "KaspiChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KaspiChannel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KaspiChannel"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "KaspiChannel" TO cyberfox_app;
