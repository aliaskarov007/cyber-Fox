-- Роль, под которой работает приложение.
--
-- Правила изоляции, поставленные прошлой миграцией, ничего не давали: владелец
-- таблиц ими не ограничен, а приложение ходит в базу именно владельцем. Проверка
-- на живой базе это и показала — под настройкой одной сети были видны обе.
--
-- Отдельная роль без прав владельца решает это без второго пароля и второго
-- подключения: приложение переключается на неё внутри транзакции запроса, и
-- правила начинают действовать. Вне запроса роль не переключается, поэтому
-- миграции и фоновые задачи работают как прежде.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cyberfox_app') THEN
    CREATE ROLE cyberfox_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cyberfox_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cyberfox_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cyberfox_app;

-- Таблицы, которые появятся в следующих миграциях, тоже должны быть доступны:
-- иначе новая таблица молча ломает работу приложения.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cyberfox_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cyberfox_app;

-- Право переключиться на эту роль — тому, под кем подключается приложение.
DO $$
BEGIN
  EXECUTE format('GRANT cyberfox_app TO %I', current_user);
END $$;
