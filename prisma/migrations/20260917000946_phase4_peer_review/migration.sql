-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "scoreBreakdown" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "submissionVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "blindSnapshot" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "tracks" ADD COLUMN     "rejectThreshold" DECIMAL(5,2) NOT NULL DEFAULT 45,
ADD COLUMN     "requiredReviews" INTEGER NOT NULL DEFAULT 2,
ALTER COLUMN "acceptanceThreshold" SET DEFAULT 70;

-- CreateTable
CREATE TABLE "reviewer_expertise" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expertiseKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredTrackIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxConcurrentAssignments" INTEGER NOT NULL DEFAULT 5,
    "completedReviewCount" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "declaredInstitution" VARCHAR(200),
    "institutionalEmailDomain" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviewer_expertise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewer_conflict_declarations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "conflictedUserId" UUID,
    "submissionId" UUID,
    "type" "ConflictType" NOT NULL,
    "reason" VARCHAR(500),
    "expiresAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviewer_conflict_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewer_expertise_tenantId_isAvailable_idx" ON "reviewer_expertise"("tenantId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "reviewer_expertise_tenantId_userId_key" ON "reviewer_expertise"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "reviewer_conflict_declarations_tenantId_reviewerId_revokedA_idx" ON "reviewer_conflict_declarations"("tenantId", "reviewerId", "revokedAt");

-- CreateIndex
CREATE INDEX "reviewer_conflict_declarations_tenantId_conflictedUserId_idx" ON "reviewer_conflict_declarations"("tenantId", "conflictedUserId");

-- CreateIndex
CREATE INDEX "reviewer_conflict_declarations_tenantId_submissionId_idx" ON "reviewer_conflict_declarations"("tenantId", "submissionId");

-- AddForeignKey
ALTER TABLE "reviewer_expertise" ADD CONSTRAINT "reviewer_expertise_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_expertise" ADD CONSTRAINT "reviewer_expertise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_conflict_declarations" ADD CONSTRAINT "reviewer_conflict_declarations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_conflict_declarations" ADD CONSTRAINT "reviewer_conflict_declarations_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_conflict_declarations" ADD CONSTRAINT "reviewer_conflict_declarations_conflictedUserId_fkey" FOREIGN KEY ("conflictedUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
