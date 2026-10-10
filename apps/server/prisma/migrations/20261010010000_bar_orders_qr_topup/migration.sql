-- Заказ из бара с игрового ПК с оплатой с баланса и пополнение по QR с игрового ПК.

-- CreateEnum
CREATE TYPE "BarOrderStatus" AS ENUM ('NEW', 'DONE', 'CANCELED');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN "barOrdersFromPc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paymentQrImageUrl" TEXT;

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "computerId" TEXT;

-- AlterTable
ALTER TABLE "ProductSale" ADD COLUMN "orderId" TEXT;

-- CreateTable
CREATE TABLE "BarOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "sessionId" TEXT,
    "computerId" TEXT NOT NULL,
    "computerName" TEXT NOT NULL,
    "status" "BarOrderStatus" NOT NULL DEFAULT 'NEW',
    "total" INTEGER NOT NULL,
    "bonusAccrued" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BarOrder_clubId_status_createdAt_idx" ON "BarOrder"("clubId", "status", "createdAt");
CREATE INDEX "ProductSale_orderId_idx" ON "ProductSale"("orderId");

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BarOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BarOrder" ADD CONSTRAINT "BarOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BarOrder" ADD CONSTRAINT "BarOrder_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BarOrder" ADD CONSTRAINT "BarOrder_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция сетей — то же правило, что и у остальных таблиц.
ALTER TABLE "BarOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BarOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BarOrder"
  USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "BarOrder" TO cyberfox_app;
