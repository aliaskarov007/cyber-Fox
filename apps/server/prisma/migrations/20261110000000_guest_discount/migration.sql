-- Личная скидка гостя в процентах на игровое время. 0 — без скидки.
ALTER TABLE "Guest" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 0;
