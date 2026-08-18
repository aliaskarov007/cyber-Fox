-- Вкладки оболочки и избранное гостя.

-- CreateEnum
CREATE TYPE "AppSection" AS ENUM ('GAME', 'APP');

-- AlterTable
ALTER TABLE "ClubApp" ADD COLUMN     "section" "AppSection" NOT NULL DEFAULT 'GAME';

-- CreateTable
CREATE TABLE "GuestFavourite" (
    "guestId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestFavourite_pkey" PRIMARY KEY ("guestId","appId")
);

-- CreateIndex
CREATE INDEX "GuestFavourite_guestId_idx" ON "GuestFavourite"("guestId");

-- AddForeignKey
ALTER TABLE "GuestFavourite" ADD CONSTRAINT "GuestFavourite_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFavourite" ADD CONSTRAINT "GuestFavourite_appId_fkey" FOREIGN KEY ("appId") REFERENCES "ClubApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

