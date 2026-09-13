-- DropIndex
DROP INDEX "Assessment_onChainId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_contractAddress_onChainId_key" ON "Assessment"("contractAddress", "onChainId");

