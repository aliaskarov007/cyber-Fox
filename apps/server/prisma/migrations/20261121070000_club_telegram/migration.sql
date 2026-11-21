-- Уведомления о действиях в клубе в Telegram: токен бота и id чата, куда слать.
ALTER TABLE "Club" ADD COLUMN "telegramBotToken" TEXT;
ALTER TABLE "Club" ADD COLUMN "telegramChatId" TEXT;
