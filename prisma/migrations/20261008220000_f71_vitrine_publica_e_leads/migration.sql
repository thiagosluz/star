-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 71 — A VITRINE VIVA DA PLATAFORMA · DESCOBERTA E EXPANSÃO (fatia 1)
--
--  1. Taxonomia de temas no banco (`EventCategory`) e coluna `category` em `events`.
--  2. Vitrine de instituições enriquecida (`coverImageUrl`, `segment`, `city`, `state`).
--  3. Tabela de plataforma `institution_leads` (sem RLS, revogada da role de runtime).
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM (
  'TECNOLOGIA',
  'CIENCIA_ACADEMICO',
  'SAUDE_BEM_ESTAR',
  'EDUCACAO',
  'NEGOCIOS_GESTAO',
  'ENGENHARIA_INDUSTRIA',
  'DIREITO_GOVERNANCA',
  'ARTE_CULTURA',
  'MEIO_AMBIENTE',
  'OUTROS'
);

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM (
  'OPEN',
  'CONTACTED',
  'QUALIFIED',
  'ARCHIVED'
);

-- AlterTable
ALTER TABLE "events" ADD COLUMN "category" "EventCategory";

-- CreateIndex
CREATE INDEX "events_category_idx" ON "events"("category");

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "coverImageUrl" VARCHAR(1024),
ADD COLUMN "segment" VARCHAR(100),
ADD COLUMN "city" VARCHAR(120),
ADD COLUMN "state" VARCHAR(2);

-- CreateTable
CREATE TABLE "institution_leads" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "organization" VARCHAR(200) NOT NULL,
    "roleInOrg" VARCHAR(120),
    "phone" VARCHAR(40),
    "estimatedEventsPerYear" VARCHAR(60),
    "message" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "internalNotes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "institution_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "institution_leads_status_createdAt_idx" ON "institution_leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "institution_leads_email_idx" ON "institution_leads"("email");

-- ═══════════════════════════════════════════════════════════════════════════════
--  institution_leads é tabela de PLATAFORMA: a role de runtime não tem acesso (FASE 71)
--  ─────────────────────────────────────────────────────────────────────────────
--  Não possui `tenantId` (o lead quer ser cliente da plataforma).
--  Acesso exclusivo via conexão administrativa (adminPrisma).
--  Revogada da role de runtime (ADR-191, ADR-353, armadilha 82 e 101).
-- ═══════════════════════════════════════════════════════════════════════════════
REVOKE ALL ON TABLE "institution_leads" FROM "eventflow_app";
REVOKE ALL ON TABLE "institution_leads" FROM PUBLIC;
