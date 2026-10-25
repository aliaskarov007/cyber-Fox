-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('REGISTRATION', 'CLOSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TournamentTeamStatus" AS ENUM ('GATHERING', 'READY', 'DISBANDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'TOURNAMENT_ENTRY';
ALTER TYPE "TransactionType" ADD VALUE 'TOURNAMENT_REFUND';
ALTER TYPE "TransactionType" ADD VALUE 'TOURNAMENT_PRIZE';

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamSize" INTEGER NOT NULL DEFAULT 1,
    "slots" INTEGER NOT NULL,
    "entryFee" INTEGER NOT NULL,
    "clubFeePercent" INTEGER NOT NULL DEFAULT 0,
    "clubBonus" INTEGER NOT NULL DEFAULT 0,
    "prizeSplit" INTEGER[] DEFAULT ARRAY[50, 30, 20]::INTEGER[],
    "gatherWindowMinutes" INTEGER NOT NULL DEFAULT 360,
    "status" "TournamentStatus" NOT NULL DEFAULT 'REGISTRATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeam" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "captainGuestId" TEXT NOT NULL,
    "status" "TournamentTeamStatus" NOT NULL DEFAULT 'GATHERING',
    "gatherDeadline" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "disbandedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEntry" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "teamId" TEXT,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "prizePlace" INTEGER,
    "prizeAmount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_eventId_key" ON "Tournament"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_code_key" ON "TournamentTeam"("code");

-- CreateIndex
CREATE INDEX "TournamentTeam_tournamentId_status_idx" ON "TournamentTeam"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentTeam_status_gatherDeadline_idx" ON "TournamentTeam"("status", "gatherDeadline");

-- CreateIndex
CREATE INDEX "TournamentEntry_tournamentId_teamId_idx" ON "TournamentEntry"("tournamentId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntry_tournamentId_guestId_key" ON "TournamentEntry"("tournamentId", "guestId");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_captainGuestId_fkey" FOREIGN KEY ("captainGuestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

