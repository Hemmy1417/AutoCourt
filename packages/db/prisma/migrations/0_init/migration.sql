-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "vinCheckDigitOk" BOOLEAN NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleClaim" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "declaredValue" TEXT NOT NULL,

    CONSTRAINT "VehicleClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimDispute" (
    "id" TEXT NOT NULL,
    "claimRowId" TEXT NOT NULL,
    "disputerId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "afterRuns" INTEGER NOT NULL DEFAULT 0,
    "onChainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "onChainId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "packetVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "uploaderRole" TEXT NOT NULL,
    "lane" TEXT NOT NULL DEFAULT 'UPLOADED',
    "declaredClass" TEXT NOT NULL,
    "declaredLabel" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "redactionStatus" TEXT NOT NULL DEFAULT 'NONE',
    "phase" TEXT NOT NULL DEFAULT 'SUBMISSION',
    "judgedVersion" INTEGER NOT NULL DEFAULT 0,
    "anchorUrl" TEXT,
    "captureDate" TEXT NOT NULL DEFAULT '',
    "onChainTxHash" TEXT,
    "consentedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceExtraction" (
    "id" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticObservation" (
    "id" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "docDate" TEXT NOT NULL,
    "odometerReading" INTEGER,
    "odometerUnit" TEXT,
    "diagnosticCode" TEXT,
    "sourceField" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DiagnosticObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionFinding" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "claimRowId" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "quotesJson" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "AssessmentFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdjudicationRun" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "packetVersion" INTEGER NOT NULL,
    "manifestRoot" TEXT NOT NULL DEFAULT '',
    "txHash" TEXT,
    "errorText" TEXT NOT NULL DEFAULT '',
    "reportJson" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdjudicationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "grounds" TEXT NOT NULL,
    "runNumber" INTEGER,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "evidenceItemId" TEXT,
    "kind" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerAccess" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viaLinkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Vehicle_sellerId_idx" ON "Vehicle"("sellerId");

-- CreateIndex
CREATE INDEX "Vehicle_vin_idx" ON "Vehicle"("vin");

-- CreateIndex
CREATE INDEX "VehicleClaim_vehicleId_idx" ON "VehicleClaim"("vehicleId");

-- CreateIndex
CREATE INDEX "ClaimDispute_claimRowId_idx" ON "ClaimDispute"("claimRowId");

-- CreateIndex
CREATE INDEX "ClaimDispute_disputerId_idx" ON "ClaimDispute"("disputerId");

-- CreateIndex
CREATE INDEX "Assessment_vehicleId_idx" ON "Assessment"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_onChainId_key" ON "Assessment"("onChainId");

-- CreateIndex
CREATE INDEX "EvidenceItem_uploaderId_idx" ON "EvidenceItem"("uploaderId");

-- CreateIndex
CREATE INDEX "EvidenceItem_fileSha256_idx" ON "EvidenceItem"("fileSha256");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_assessmentId_evidenceId_key" ON "EvidenceItem"("assessmentId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceExtraction_evidenceItemId_key" ON "EvidenceExtraction"("evidenceItemId");

-- CreateIndex
CREATE INDEX "DiagnosticObservation_evidenceItemId_idx" ON "DiagnosticObservation"("evidenceItemId");

-- CreateIndex
CREATE INDEX "InspectionFinding_assessmentId_idx" ON "InspectionFinding"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentFinding_runId_idx" ON "AssessmentFinding"("runId");

-- CreateIndex
CREATE INDEX "AssessmentFinding_claimRowId_idx" ON "AssessmentFinding"("claimRowId");

-- CreateIndex
CREATE INDEX "AdjudicationRun_assessmentId_idx" ON "AdjudicationRun"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AdjudicationRun_assessmentId_runNumber_createdAt_key" ON "AdjudicationRun"("assessmentId", "runNumber", "createdAt");

-- CreateIndex
CREATE INDEX "Appeal_assessmentId_idx" ON "Appeal"("assessmentId");

-- CreateIndex
CREATE INDEX "AuditEvent_evidenceItemId_idx" ON "AuditEvent"("evidenceItemId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerAccess_assessmentId_userId_key" ON "BuyerAccess"("assessmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_assessmentId_idx" ON "ShareLink"("assessmentId");

-- CreateIndex
CREATE INDEX "Job_state_lockedUntil_idx" ON "Job"("state", "lockedUntil");

-- CreateIndex
CREATE INDEX "Job_assessmentId_idx" ON "Job"("assessmentId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleClaim" ADD CONSTRAINT "VehicleClaim_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDispute" ADD CONSTRAINT "ClaimDispute_claimRowId_fkey" FOREIGN KEY ("claimRowId") REFERENCES "VehicleClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDispute" ADD CONSTRAINT "ClaimDispute_disputerId_fkey" FOREIGN KEY ("disputerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceExtraction" ADD CONSTRAINT "EvidenceExtraction_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticObservation" ADD CONSTRAINT "DiagnosticObservation_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentFinding" ADD CONSTRAINT "AssessmentFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AdjudicationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentFinding" ADD CONSTRAINT "AssessmentFinding_claimRowId_fkey" FOREIGN KEY ("claimRowId") REFERENCES "VehicleClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentFinding" ADD CONSTRAINT "AssessmentFinding_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjudicationRun" ADD CONSTRAINT "AdjudicationRun_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAccess" ADD CONSTRAINT "BuyerAccess_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAccess" ADD CONSTRAINT "BuyerAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

