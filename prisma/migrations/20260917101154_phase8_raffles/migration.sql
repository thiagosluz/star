-- CreateEnum
CREATE TYPE "RaffleScope" AS ENUM ('EVENT', 'DAY', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT', 'DRAWN', 'CANCELED');

-- CreateTable
CREATE TABLE "raffles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "activityId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "scope" "RaffleScope" NOT NULL,
    "referenceDate" DATE,
    "minAttendanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "winnersCount" INTEGER NOT NULL,
    "allowPriorEventWinners" BOOLEAN NOT NULL DEFAULT false,
    "status" "RaffleStatus" NOT NULL DEFAULT 'DRAFT',
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "inspectedAttendances" INTEGER NOT NULL DEFAULT 0,
    "drawnAt" TIMESTAMPTZ(6),
    "resultHash" CHAR(64),
    "drawVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "raffles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raffle_winners" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "raffleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "attendanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "attendanceId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raffle_winners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raffles_tenantId_eventId_status_idx" ON "raffles"("tenantId", "eventId", "status");

-- CreateIndex
CREATE INDEX "raffles_tenantId_eventId_drawnAt_idx" ON "raffles"("tenantId", "eventId", "drawnAt");

-- CreateIndex
CREATE INDEX "raffle_winners_tenantId_userId_idx" ON "raffle_winners"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "raffle_winners_raffleId_userId_key" ON "raffle_winners"("raffleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "raffle_winners_raffleId_position_key" ON "raffle_winners"("raffleId", "position");

-- AddForeignKey
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_winners" ADD CONSTRAINT "raffle_winners_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_winners" ADD CONSTRAINT "raffle_winners_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "raffles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_winners" ADD CONSTRAINT "raffle_winners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raffle_winners" ADD CONSTRAINT "raffle_winners_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
