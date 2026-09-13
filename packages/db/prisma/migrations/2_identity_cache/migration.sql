-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "identityStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "registryJson" TEXT NOT NULL DEFAULT '{}';

