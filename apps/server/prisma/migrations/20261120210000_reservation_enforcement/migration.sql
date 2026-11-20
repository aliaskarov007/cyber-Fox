-- Поведение при наступлении брони на занятом ПК и метки, чтобы не дублировать.
ALTER TABLE "Club" ADD COLUMN "reservationAutoLock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Reservation" ADD COLUMN "warnedAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "enforcedAt" TIMESTAMP(3);
