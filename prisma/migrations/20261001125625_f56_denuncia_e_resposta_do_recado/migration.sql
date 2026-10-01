-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "ProfileReportCategory" AS ENUM ('FALSE_IDENTITY', 'OFFENSIVE_CONTENT', 'PRIVACY', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ProfileReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

-- DropForeignKey
ALTER TABLE "sponsor_qr_codes" DROP CONSTRAINT "sponsor_qr_codes_createdById_fkey";

-- DropForeignKey
ALTER TABLE "sponsor_users" DROP CONSTRAINT "sponsor_users_invitedById_fkey";

-- DropIndex
DROP INDEX "call_for_proposals_tenantId_deletedAt_idx";

-- DropIndex
DROP INDEX "event_credentials_category_idx";

-- DropIndex
DROP INDEX "event_pages_tenantId_eventId_unpublishAt_idx";

-- DropIndex
DROP INDEX "raffle_winners_raffleId_kind_idx";

-- DropIndex
DROP INDEX "raffles_eventId_isPublic_status_idx";

-- DropIndex
DROP INDEX "registrations_event_origin_idx";

-- AlterTable
ALTER TABLE "call_for_proposals" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "event_credentials" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "event_page_versions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "snapshot" DROP DEFAULT;

-- AlterTable
ALTER TABLE "media_assets" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "participant_messages" ADD COLUMN     "direction" "MessageDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "parentId" UUID;

-- AlterTable
ALTER TABLE "raffle_rounds" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "speaker_materials" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "speaker_profiles" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "socialLinks" SET DATA TYPE JSONB,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "publicProfileHiddenAt" TIMESTAMPTZ(6),
ADD COLUMN     "publicProfileHiddenReason" VARCHAR(500);

-- CreateTable
CREATE TABLE "profile_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reportedUserId" UUID NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "category" "ProfileReportCategory" NOT NULL,
    "details" VARCHAR(2000) NOT NULL,
    "status" "ProfileReportStatus" NOT NULL DEFAULT 'OPEN',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_reports_status_createdAt_idx" ON "profile_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "profile_reports_tenantId_status_idx" ON "profile_reports"("tenantId", "status");

-- CreateIndex
CREATE INDEX "profile_reports_reportedUserId_idx" ON "profile_reports"("reportedUserId");

-- CreateIndex
CREATE INDEX "participant_messages_tenantId_parentId_idx" ON "participant_messages"("tenantId", "parentId");

-- RenameForeignKey
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_tenantid_fkey" TO "audit_logs_tenantId_fkey";

-- RenameForeignKey
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_userid_fkey" TO "audit_logs_userId_fkey";

-- RenameForeignKey
ALTER TABLE "event_credentials" RENAME CONSTRAINT "event_credentials_eventid_fkey" TO "event_credentials_eventId_fkey";

-- RenameForeignKey
ALTER TABLE "event_credentials" RENAME CONSTRAINT "event_credentials_issuedbyid_fkey" TO "event_credentials_issuedById_fkey";

-- RenameForeignKey
ALTER TABLE "event_credentials" RENAME CONSTRAINT "event_credentials_printedbyid_fkey" TO "event_credentials_printedById_fkey";

-- RenameForeignKey
ALTER TABLE "event_credentials" RENAME CONSTRAINT "event_credentials_revokedbyid_fkey" TO "event_credentials_revokedById_fkey";

-- RenameForeignKey
ALTER TABLE "event_credentials" RENAME CONSTRAINT "event_credentials_tenantid_fkey" TO "event_credentials_tenantId_fkey";

-- RenameForeignKey
ALTER TABLE "event_credentials" RENAME CONSTRAINT "event_credentials_userid_fkey" TO "event_credentials_userId_fkey";

-- RenameForeignKey
ALTER TABLE "raffle_rounds" RENAME CONSTRAINT "raffle_rounds_createdbyid_fkey" TO "raffle_rounds_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "raffle_rounds" RENAME CONSTRAINT "raffle_rounds_raffleid_fkey" TO "raffle_rounds_raffleId_fkey";

-- RenameForeignKey
ALTER TABLE "raffle_rounds" RENAME CONSTRAINT "raffle_rounds_sponsorid_fkey" TO "raffle_rounds_sponsorId_fkey";

-- RenameForeignKey
ALTER TABLE "raffle_rounds" RENAME CONSTRAINT "raffle_rounds_tenantid_fkey" TO "raffle_rounds_tenantId_fkey";

-- AddForeignKey
ALTER TABLE "participant_messages" ADD CONSTRAINT "participant_messages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "participant_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "event_credentials_eventid_userid_key" RENAME TO "event_credentials_eventId_userId_key";

-- RenameIndex
ALTER INDEX "event_credentials_tenantid_eventid_status_idx" RENAME TO "event_credentials_tenantId_eventId_status_idx";

-- RenameIndex
ALTER INDEX "event_credentials_tenantid_userid_idx" RENAME TO "event_credentials_tenantId_userId_idx";

-- RenameIndex
ALTER INDEX "raffle_rounds_raffleid_roundnumber_key" RENAME TO "raffle_rounds_raffleId_roundNumber_key";

-- RenameIndex
ALTER INDEX "raffle_rounds_sponsorid_idx" RENAME TO "raffle_rounds_sponsorId_idx";

-- RenameIndex
ALTER INDEX "raffle_rounds_tenantid_raffleid_drawnat_idx" RENAME TO "raffle_rounds_tenantId_raffleId_drawnAt_idx";

-- RenameIndex
ALTER INDEX "raffle_winners_raffleid_roundnumber_idx" RENAME TO "raffle_winners_raffleId_roundNumber_idx";

-- RenameIndex
ALTER INDEX "registration_confirmation_items_tenantId_registrationId_status_" RENAME TO "registration_confirmation_items_tenantId_registrationId_sta_idx";
