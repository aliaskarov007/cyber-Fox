-- Журнал операций, выполненных без связи с облаком. UUID генерируется на
-- устройстве и служит ключом идемпотентности при повторной досылке пачки.
CREATE TABLE "OfflineOperation" (
    "uuid" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "lastKnownServerTime" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfflineOperation_pkey" PRIMARY KEY ("uuid")
);

CREATE INDEX "OfflineOperation_computerId_sequence_idx" ON "OfflineOperation"("computerId", "sequence");
CREATE INDEX "OfflineOperation_sessionId_idx" ON "OfflineOperation"("sessionId");

ALTER TABLE "OfflineOperation" ADD CONSTRAINT "OfflineOperation_computerId_fkey"
    FOREIGN KEY ("computerId") REFERENCES "Computer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfflineOperation" ADD CONSTRAINT "OfflineOperation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
