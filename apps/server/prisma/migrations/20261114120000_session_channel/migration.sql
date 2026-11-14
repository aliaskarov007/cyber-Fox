-- Локальный IP машины и выбранный на сессию интернет-канал.
ALTER TABLE "Computer" ADD COLUMN "lanIp" TEXT;
ALTER TABLE "Session" ADD COLUMN "internetChannelId" TEXT;
ALTER TABLE "Session" ADD CONSTRAINT "Session_internetChannelId_fkey" FOREIGN KEY ("internetChannelId") REFERENCES "InternetChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
