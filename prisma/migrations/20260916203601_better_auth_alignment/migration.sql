/*
  Warnings:

  - You are about to drop the column `activeTenantId` on the `session` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "session_activeTenantId_idx";

-- AlterTable
ALTER TABLE "session" DROP COLUMN "activeTenantId",
ADD COLUMN     "lastTenantId" UUID;
