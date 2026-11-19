-- Сверка безнала при закрытии смены: карта по терминалу, онлайн по выписке Kaspi.
ALTER TABLE "Shift" ADD COLUMN "cardCounted" INTEGER;
ALTER TABLE "Shift" ADD COLUMN "onlineCounted" INTEGER;
