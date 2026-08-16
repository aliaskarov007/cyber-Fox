-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'BONUS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'BONUS_ACCRUAL';
ALTER TYPE "TransactionType" ADD VALUE 'BONUS_SPEND';

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "bonusPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "note" TEXT,
ADD COLUMN     "openingFloat" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "price" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSale" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "guestId" TEXT,
    "sessionId" TEXT,
    "shiftId" TEXT,
    "staffId" TEXT,
    "quantity" INTEGER NOT NULL,
    "priceAtSale" INTEGER NOT NULL,
    "costAtSale" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_clubId_idx" ON "Product"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_clubId_name_key" ON "Product"("clubId", "name");

-- CreateIndex
CREATE INDEX "ProductSale_clubId_createdAt_idx" ON "ProductSale"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductSale_shiftId_idx" ON "ProductSale"("shiftId");

-- CreateIndex
CREATE INDEX "ProductSale_guestId_idx" ON "ProductSale"("guestId");

-- CreateIndex
CREATE INDEX "Shift_clubId_closedAt_idx" ON "Shift"("clubId", "closedAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
