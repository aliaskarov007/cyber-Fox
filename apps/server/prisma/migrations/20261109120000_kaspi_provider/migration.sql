-- Прямое подключение к Kaspi.kz по протоколу провайдера (check/pay).

-- CreateTable
CREATE TABLE "KaspiProviderChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KaspiProviderChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KaspiTxn" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "txnDate" TIMESTAMP(3),
    "guestId" TEXT,
    "intentId" TEXT,
    "result" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KaspiTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KaspiProviderChannel_tenantId_key" ON "KaspiProviderChannel"("tenantId");
CREATE UNIQUE INDEX "KaspiProviderChannel_token_key" ON "KaspiProviderChannel"("token");
CREATE UNIQUE INDEX "KaspiTxn_txnId_key" ON "KaspiTxn"("txnId");
CREATE UNIQUE INDEX "KaspiTxn_intentId_key" ON "KaspiTxn"("intentId");
CREATE INDEX "KaspiTxn_tenantId_createdAt_idx" ON "KaspiTxn"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "KaspiProviderChannel" ADD CONSTRAINT "KaspiProviderChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KaspiTxn" ADD CONSTRAINT "KaspiTxn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KaspiTxn" ADD CONSTRAINT "KaspiTxn_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "KaspiProviderChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KaspiProviderChannel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KaspiProviderChannel"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

ALTER TABLE "KaspiTxn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KaspiTxn" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KaspiTxn"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "KaspiProviderChannel" TO cyberfox_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "KaspiTxn" TO cyberfox_app;
GRANT USAGE, SELECT ON SEQUENCE "KaspiTxn_id_seq" TO cyberfox_app;
