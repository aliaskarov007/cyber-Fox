-- Найденные агентом игры: то, что стоит на машинах, но ещё не на полках.

-- CreateTable
CREATE TABLE "AppSuggestion" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AppLaunchKind" NOT NULL DEFAULT 'URI',
    "target" TEXT NOT NULL,
    "coverUrl" TEXT,
    "computerId" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppSuggestion_clubId_idx" ON "AppSuggestion"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSuggestion_clubId_target_key" ON "AppSuggestion"("clubId", "target");

-- AddForeignKey
ALTER TABLE "AppSuggestion" ADD CONSTRAINT "AppSuggestion_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

