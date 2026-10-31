-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "phone" TEXT;

-- CreateTable
CREATE TABLE "StaffPasswordReset" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffPasswordReset_staffId_createdAt_idx" ON "StaffPasswordReset"("staffId", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffPasswordReset" ADD CONSTRAINT "StaffPasswordReset_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Код сброса принадлежит сотруднику: сеть достаётся через него
-- (то же правило, что у PhoneVerification).
ALTER TABLE "StaffPasswordReset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffPasswordReset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffPasswordReset"
  USING (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Staff" s WHERE s.id = "StaffPasswordReset"."staffId" AND s."tenantId" = cyberfox_tenant())
  )
  WITH CHECK (
    cyberfox_tenant() IS NULL
    OR EXISTS (SELECT 1 FROM "Staff" s WHERE s.id = "StaffPasswordReset"."staffId" AND s."tenantId" = cyberfox_tenant())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "StaffPasswordReset" TO cyberfox_app;
