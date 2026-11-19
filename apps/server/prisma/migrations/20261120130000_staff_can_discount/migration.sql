-- Право сотрудника выдавать гостям скидку. По умолчанию выключено: раньше
-- любой кассир мог раздавать скидки, теперь это решает владелец сети.
ALTER TABLE "Staff" ADD COLUMN "canDiscount" BOOLEAN NOT NULL DEFAULT false;
