-- Авто-перезагрузка/выключение ПК по простою после сессии.
ALTER TABLE "Club" ADD COLUMN "idlePowerAction" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Club" ADD COLUMN "idlePowerMinutes" INTEGER NOT NULL DEFAULT 10;
