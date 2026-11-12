-- Положение зала на плане клуба и форма раскладки машин внутри зала.
ALTER TABLE "Zone" ADD COLUMN "posX" INTEGER;
ALTER TABLE "Zone" ADD COLUMN "posY" INTEGER;
ALTER TABLE "Zone" ADD COLUMN "layout" TEXT NOT NULL DEFAULT 'GRID';
