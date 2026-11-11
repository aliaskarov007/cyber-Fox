-- Заказ бара с игрового ПК переходит на оплату картой онлайн.

-- Новая цель платежа и состояние заказа «ждёт оплаты».
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'BAR_ORDER';
ALTER TYPE "BarOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';

-- Какой заказ оплачивает платёж: подтверждение Kaspi пробивает именно его.
ALTER TABLE "PaymentIntent" ADD COLUMN "barOrderId" TEXT;
CREATE INDEX "PaymentIntent_barOrderId_idx" ON "PaymentIntent"("barOrderId");
