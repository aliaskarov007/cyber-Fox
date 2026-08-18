-- Отзыв токенов сотрудника: увольнение и смена пароля поднимают версию,
-- прежние токены перестают действовать.

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

