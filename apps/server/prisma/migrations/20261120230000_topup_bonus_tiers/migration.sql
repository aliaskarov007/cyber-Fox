-- Пороги бонуса за пополнение: пополнил не меньше порога — получил бонус.
CREATE TABLE "TopUpBonusTier" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "minTopUp" INTEGER NOT NULL,
    "bonus" INTEGER NOT NULL,
    CONSTRAINT "TopUpBonusTier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopUpBonusTier_clubId_idx" ON "TopUpBonusTier"("clubId");

ALTER TABLE "TopUpBonusTier" ADD CONSTRAINT "TopUpBonusTier_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
