-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "confirmedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitlistCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "confirmedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitlistCount" INTEGER NOT NULL DEFAULT 0;
