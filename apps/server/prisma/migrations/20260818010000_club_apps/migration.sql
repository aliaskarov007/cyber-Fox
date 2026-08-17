-- Каталог игр клуба: полки оболочки, которую видит гость после оплаты.
-- Принадлежит клубу, а не машине: в бездисковом зале образ общий, и путь
-- до игры одинаковый на всех машинах.

-- CreateEnum
CREATE TYPE "AppLaunchKind" AS ENUM ('EXECUTABLE', 'URI');

-- CreateTable
CREATE TABLE "ClubApp" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "zoneId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "kind" "AppLaunchKind" NOT NULL DEFAULT 'EXECUTABLE',
    "target" TEXT NOT NULL,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubApp_clubId_idx" ON "ClubApp"("clubId");

-- CreateIndex
CREATE INDEX "ClubApp_zoneId_idx" ON "ClubApp"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubApp_clubId_name_key" ON "ClubApp"("clubId", "name");

-- AddForeignKey
ALTER TABLE "ClubApp" ADD CONSTRAINT "ClubApp_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubApp" ADD CONSTRAINT "ClubApp_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

