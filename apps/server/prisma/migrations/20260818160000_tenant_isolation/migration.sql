-- Изоляция сетей на уровне базы.
--
-- До сих пор сети разделяли только проверки в коде. Все они на месте, но одна
-- забытая в новом эндпоинте показывает соседнему клубу чужую выручку, и узнать
-- об этом можно от самого соседа. Здесь база сама отказывается отдавать чужие
-- строки, даже если приложение попросило.
--
-- Правило одно на все таблицы: строка видна, если её сеть совпадает с той, что
-- приложение положило в настройку app.tenant_id на время запроса.
--
-- Важная оговорка, записанная прямо здесь, чтобы не потерялась: когда настройка
-- не задана, ограничение не действует. Так работают пути, у которых сети нет и
-- быть не может, — подключения игровых машин и фоновый счётчик минут. Это
-- защита от забытой проверки в API, а не от чего угодно.

CREATE OR REPLACE FUNCTION cyberfox_tenant() RETURNS text AS $$
  SELECT current_setting('app.tenant_id', true);
$$ LANGUAGE sql STABLE;

-- 1. Таблицы, где сеть указана прямо.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Club', 'Guest', 'Staff', 'Subscription', 'Invoice', 'PaymentIntent']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())
       WITH CHECK (cyberfox_tenant() IS NULL OR "tenantId" = cyberfox_tenant())', t);
  END LOOP;
END $$;

-- Сама сеть сверяется по своему идентификатору.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING (cyberfox_tenant() IS NULL OR id = cyberfox_tenant())
  WITH CHECK (cyberfox_tenant() IS NULL OR id = cyberfox_tenant());

-- 2. Таблицы, принадлежащие клубу: сеть достаётся через клуб.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Zone', 'Computer', 'Tariff', 'GuestPackage', 'Session',
                           'Product', 'ProductSale', 'Payment', 'Shift', 'ClubApp',
                           'AppSuggestion', 'Transaction']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (
         cyberfox_tenant() IS NULL
         OR EXISTS (SELECT 1 FROM "Club" c WHERE c.id = %I."clubId" AND c."tenantId" = cyberfox_tenant())
       ) WITH CHECK (
         cyberfox_tenant() IS NULL
         OR EXISTS (SELECT 1 FROM "Club" c WHERE c.id = %I."clubId" AND c."tenantId" = cyberfox_tenant())
       )', t, t, t);
  END LOOP;
END $$;

-- 3. Кошелёк гостя: клуб у него может быть пустым — тогда кошелёк общий по сети
-- и сверяется через самого гостя.
ALTER TABLE "GuestWallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestWallet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GuestWallet"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Guest" g WHERE g.id = "GuestWallet"."guestId" AND g."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Guest" g WHERE g.id = "GuestWallet"."guestId" AND g."tenantId" = cyberfox_tenant())
  );

-- 4. Отрезки сессии и офлайн-операции: сеть достаётся через сессию и машину.
ALTER TABLE "SessionSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionSegment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SessionSegment"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (
      SELECT 1 FROM "Session" s JOIN "Club" c ON c.id = s."clubId"
      WHERE s.id = "SessionSegment"."sessionId" AND c."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (
      SELECT 1 FROM "Session" s JOIN "Club" c ON c.id = s."clubId"
      WHERE s.id = "SessionSegment"."sessionId" AND c."tenantId" = cyberfox_tenant())
  );

ALTER TABLE "OfflineOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfflineOperation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OfflineOperation"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (
      SELECT 1 FROM "Computer" m JOIN "Club" c ON c.id = m."clubId"
      WHERE m.id = "OfflineOperation"."computerId" AND c."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (
      SELECT 1 FROM "Computer" m JOIN "Club" c ON c.id = m."clubId"
      WHERE m.id = "OfflineOperation"."computerId" AND c."tenantId" = cyberfox_tenant())
  );
