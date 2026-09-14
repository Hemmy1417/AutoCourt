-- One recorded run per job. The tx hash cannot be the key: an attempt that
-- failed before it had a hash has none, and was recorded again on every pass.
-- AlterTable
ALTER TABLE "AdjudicationRun" ADD COLUMN "jobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AdjudicationRun_jobId_key" ON "AdjudicationRun"("jobId");
