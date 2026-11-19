-- Движение наличных в кассе помимо продаж: внесения, выемки, расходы, возвраты.
-- Без учёта этих движений касса всегда расходится при любой выемке или закупке.
CREATE TYPE "CashMovementKind" AS ENUM ('DEPOSIT', 'DROP', 'EXPENSE', 'REFUND');

CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "staffId" TEXT,
    "kind" "CashMovementKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
