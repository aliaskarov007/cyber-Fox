-- Бездисковые залы: машины называют себя MAC-адресом, клуб опознаётся по ключу.

-- Ключ клуба. Существующим клубам раздаём сразу, чтобы колонку можно было
-- сделать обязательной.
ALTER TABLE "Club" ADD COLUMN "enrollmentKey" TEXT;
UPDATE "Club" SET "enrollmentKey" = gen_random_uuid()::text WHERE "enrollmentKey" IS NULL;
ALTER TABLE "Club" ALTER COLUMN "enrollmentKey" SET NOT NULL;
ALTER TABLE "Club" ALTER COLUMN "enrollmentKey" SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX "Club_enrollmentKey_key" ON "Club"("enrollmentKey");

-- MAC машины. NULL у машин с обычными дисками — там опознание по коду привязки.
-- Уникальный индекс в PostgreSQL не считает NULL совпадающими, поэтому таких
-- машин может быть сколько угодно.
ALTER TABLE "Computer" ADD COLUMN "macAddress" TEXT;
CREATE UNIQUE INDEX "Computer_clubId_macAddress_key" ON "Computer"("clubId", "macAddress");
