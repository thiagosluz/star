-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 111 — Publicação de Anais, Citações e Indexação (custo zero)
--
--  1. Enum `ProceedingsStatus` (DRAFT, PUBLISHED, ARCHIVED).
--  2. Registro explícito de ciência/autorização em `submissions`.
--  3. Tabelas `proceedings_volumes` e `proceedings_entries` sob RLS + FORCE.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ProceedingsStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "submissions"
  ADD COLUMN "proceedingsPermissionAcceptedAt" TIMESTAMPTZ(6),
  ADD COLUMN "proceedingsPermissionVersion" VARCHAR(32);

-- CreateTable
CREATE TABLE "proceedings_volumes" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "status" "ProceedingsStatus" NOT NULL DEFAULT 'DRAFT',
  "title" VARCHAR(300) NOT NULL,
  "subtitle" VARCHAR(400),
  "volumeLabel" VARCHAR(80),
  "editionYear" INTEGER NOT NULL,
  "editors" VARCHAR(500),
  "isbn" VARCHAR(32),
  "issn" VARCHAR(32),
  "publisherName" VARCHAR(200),
  "preface" TEXT,
  "publishedAt" TIMESTAMPTZ(6),
  "publishedById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "proceedings_volumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proceedings_entries" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "volumeId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 1,
  "sectionName" VARCHAR(200),
  "pageStart" INTEGER,
  "pageEnd" INTEGER,
  "externalDoi" VARCHAR(200),
  "publicFileKind" "SubmissionFileKind",
  "includeInProceedings" BOOLEAN NOT NULL DEFAULT true,
  "snapshot" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "proceedings_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proceedings_volumes_eventId_key" ON "proceedings_volumes"("eventId");
CREATE INDEX "proceedings_volumes_tenantId_status_idx" ON "proceedings_volumes"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proceedings_entries_submissionId_key" ON "proceedings_entries"("submissionId");
CREATE UNIQUE INDEX "proceedings_entries_volumeId_submissionId_key" ON "proceedings_entries"("volumeId", "submissionId");
CREATE INDEX "proceedings_entries_tenantId_volumeId_displayOrder_idx" ON "proceedings_entries"("tenantId", "volumeId", "displayOrder");

-- AddForeignKey
ALTER TABLE "proceedings_volumes"
  ADD CONSTRAINT "proceedings_volumes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "proceedings_volumes_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceedings_entries"
  ADD CONSTRAINT "proceedings_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "proceedings_entries_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "proceedings_volumes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "proceedings_entries_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS + FORCE + GRANTs para a role de runtime ───────────────────────────────
ALTER TABLE "proceedings_volumes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proceedings_volumes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "proceedings_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proceedings_entries" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['proceedings_volumes', 'proceedings_entries']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = format('public.%I', tabela)::regclass
         AND polname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I
           USING ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)
           WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)',
        tabela
      );
    END IF;
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proceedings_volumes TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proceedings_entries TO eventflow_app;
