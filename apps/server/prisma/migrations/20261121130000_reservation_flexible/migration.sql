-- Гибкое бронирование: зона + конкретные ПК (в т.ч. диапазон) или количество ПК.
ALTER TABLE "Reservation" ADD COLUMN "quantity" INTEGER;

CREATE TABLE "ReservationComputer" (
    "reservationId" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    CONSTRAINT "ReservationComputer_pkey" PRIMARY KEY ("reservationId", "computerId")
);

CREATE INDEX "ReservationComputer_computerId_idx" ON "ReservationComputer"("computerId");

ALTER TABLE "ReservationComputer" ADD CONSTRAINT "ReservationComputer_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationComputer" ADD CONSTRAINT "ReservationComputer_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "Computer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
