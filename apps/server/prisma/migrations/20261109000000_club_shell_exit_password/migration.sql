-- Пароль выхода из оболочки, свой у каждого клуба. Хэш bcrypt; null — не задан.
ALTER TABLE "Club" ADD COLUMN "shellExitPasswordHash" TEXT;
