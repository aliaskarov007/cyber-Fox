-- Форматы пакетов («N+M», ночной, абонемент) и перенос остатка абонемента.

-- CreateEnum
CREATE TYPE "PackageFormat" AS ENUM ('MINUTES', 'NIGHT', 'SUBSCRIPTION');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "renewAfterDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "renewBeforeDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "rolloverCapPercent" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "rolloverPercent" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "rolloverStreakPercent" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "GuestPackage" ADD COLUMN     "carriedFromId" TEXT,
ADD COLUMN     "carriedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renewedById" TEXT,
ADD COLUMN     "rolledOverAt" TIMESTAMP(3),
ADD COLUMN     "streak" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Tariff" ADD COLUMN     "bonusMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "packageFormat" "PackageFormat" NOT NULL DEFAULT 'MINUTES';
