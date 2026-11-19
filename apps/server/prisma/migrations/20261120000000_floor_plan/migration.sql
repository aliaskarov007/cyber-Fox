-- План помещения: размеры зон-комнат и новые типы объектов (служебная область, дверь).
ALTER TABLE "Zone" ADD COLUMN "width" INTEGER;
ALTER TABLE "Zone" ADD COLUMN "height" INTEGER;

ALTER TYPE "MapObjectKind" ADD VALUE IF NOT EXISTS 'AREA';
ALTER TYPE "MapObjectKind" ADD VALUE IF NOT EXISTS 'DOOR';
