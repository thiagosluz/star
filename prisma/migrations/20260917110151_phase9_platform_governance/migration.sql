-- AlterEnum
ALTER TYPE "RoleKey" ADD VALUE 'SUPERADMIN';

-- AlterEnum
ALTER TYPE "RoleScope" ADD VALUE 'PLATFORM';

-- AlterTable
ALTER TABLE "role_assignments" ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(6),
ADD COLUMN     "suspensionReason" VARCHAR(400),
ADD COLUMN     "websiteUrl" VARCHAR(1024);

-- CreateIndex
CREATE INDEX "role_assignments_userId_scope_idx" ON "role_assignments"("userId", "scope");
