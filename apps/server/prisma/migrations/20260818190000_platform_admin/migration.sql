-- Учётные записи платформы: те, кто продаёт систему клубам.

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");


-- Правила изоляции сетей на эту таблицу не ставятся: она не принадлежит ни
-- одной сети, и запросы к ней идут вне сетевого ограничения.
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformAdmin" TO cyberfox_app;
