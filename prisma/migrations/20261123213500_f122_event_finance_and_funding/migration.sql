-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 122 — Gestão Financeira, Fomento e Prestação de Contas do Evento
--
--  1. Tabela `event_funding_sources` (editais FAPEG/CNPq/CAPES, FUNAPE, UF/IF, patrocínio).
--  2. Tabela `event_financial_entries` (entradas e saídas em centavos, rubricas e documentos).
--  3. RLS + FORCE + policy `tenant_isolation` + GRANTs para `eventflow_app`.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "event_funding_sources" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "kind" VARCHAR(32) NOT NULL DEFAULT 'PUBLIC_GRANT',
  "codeOrProcess" VARCHAR(120),
  "approvedCents" INTEGER NOT NULL DEFAULT 0,
  "restrictedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sponsorId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "event_funding_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_financial_entries" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "sourceId" UUID,
  "type" VARCHAR(16) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PLANNED',
  "category" VARCHAR(48) NOT NULL DEFAULT 'OTHER',
  "title" VARCHAR(200) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "occurredOn" VARCHAR(10) NOT NULL,
  "settledOn" VARCHAR(10),
  "counterpartyName" VARCHAR(180),
  "counterpartyTaxId" VARCHAR(32),
  "documentNumber" VARCHAR(80),
  "notes" TEXT,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "event_financial_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_funding_sources_tenantId_eventId_kind_idx"
  ON "event_funding_sources"("tenantId", "eventId", "kind");
CREATE INDEX "event_funding_sources_sponsorId_idx"
  ON "event_funding_sources"("sponsorId");

CREATE INDEX "event_financial_entries_tenantId_eventId_type_status_idx"
  ON "event_financial_entries"("tenantId", "eventId", "type", "status");
CREATE INDEX "event_financial_entries_tenantId_eventId_occurredOn_idx"
  ON "event_financial_entries"("tenantId", "eventId", "occurredOn");
CREATE INDEX "event_financial_entries_sourceId_idx"
  ON "event_financial_entries"("sourceId");

ALTER TABLE "event_funding_sources"
  ADD CONSTRAINT "event_funding_sources_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "event_funding_sources_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "event_funding_sources_sponsorId_fkey"
    FOREIGN KEY ("sponsorId") REFERENCES "sponsors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "event_financial_entries"
  ADD CONSTRAINT "event_financial_entries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "event_financial_entries_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "event_financial_entries_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "event_funding_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RLS + FORCE + GRANTs para a role de runtime ───────────────────────────────
ALTER TABLE "event_funding_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_funding_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_financial_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_financial_entries" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['event_funding_sources', 'event_financial_entries']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_funding_sources TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_financial_entries TO eventflow_app;
