-- БИН/ИИН получателя платежей Kaspi: Kaspi просит его в каждом ответе check/pay.
ALTER TABLE "KaspiProviderChannel" ADD COLUMN "bin" TEXT;
