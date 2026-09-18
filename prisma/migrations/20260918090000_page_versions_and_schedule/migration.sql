-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 23 — Conteúdo e mídia
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  O que esta migração acrescenta:
--
--    E12  tabela `event_page_versions`          → histórico com restauração
--    E13  `event_pages."publishAt"`             → publicação agendada
--
--  E9 (pré-visualização), E10 (upload na galeria) e E11 (reaproveitar
--  patrocinador) são só código: a prévia lê o rascunho que já existe, o upload usa
--  o bucket de assets que já existe, e a cópia de patrocinador grava na tabela que
--  já existe.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE A VISIBILIDADE AGENDADA É DECIDIDA NA LEITURA
--  ─────────────────────────────────────────────────────────────────────────────
--  `publishAt` NÃO é um job: é a hora em que a página passa a ser considerada
--  pública na consulta (`publishAt <= now()`). A plataforma não tem agendador — a
--  manutenção de partições da auditoria depende de cron externo (dívida B7) — e um
--  agendador que não roda deixaria a campanha fora do ar sem ninguém perceber no
--  dia. Com a decisão na leitura, o relógio do banco é a fonte da verdade.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  RLS DA TABELA NOVA
--  ─────────────────────────────────────────────────────────────────────────────
--  `event_page_versions` tem `tenantId`, então o loop de introspecção da migração
--  20260917191000 aplica `ENABLE`/`FORCE` + policy `tenant_isolation` nela. Como a
--  tabela nasce NESTA migração (depois daquela), a policy é criada AQUI — repetindo
--  exatamente o bloco daquela migração — e o `npm run db:verify` confirma.
--
--  Migração aplicada UMA vez pelo ledger do `prisma migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Publicação agendada (E13) ──────────────────────────────────────────────
ALTER TABLE public.event_pages
  ADD COLUMN IF NOT EXISTS "publishAt" TIMESTAMPTZ(6);

-- A leitura pública passa a considerar `publishAt`, então ele entra no índice.
CREATE INDEX IF NOT EXISTS "event_pages_tenantId_eventId_publishAt_idx"
  ON public.event_pages ("tenantId", "eventId", "publishAt");

-- ── 2. Histórico de versões da página (E12) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_page_versions (
  id           UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"   UUID           NOT NULL,
  "pageId"     UUID           NOT NULL,
  reason       VARCHAR(120)   NOT NULL,
  snapshot     JSONB          NOT NULL DEFAULT '{}',
  checksum     CHAR(64)       NOT NULL,
  "createdById" UUID,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT event_page_versions_pkey PRIMARY KEY (id),
  CONSTRAINT "event_page_versions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "event_page_versions_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES public.event_pages(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  -- A conta pode ser removida; a versão permanece (o crédito da alteração é
  -- histórico, não dado pessoal que precise sumir).
  CONSTRAINT "event_page_versions_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES public."user"(id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "event_page_versions_tenantId_pageId_createdAt_idx"
  ON public.event_page_versions ("tenantId", "pageId", "createdAt");

CREATE INDEX IF NOT EXISTS "event_page_versions_createdById_idx"
  ON public.event_page_versions ("createdById");

-- ── 3. RLS: ENABLE + FORCE + policy de isolamento (tabela nova) ───────────────
ALTER TABLE public.event_page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_page_versions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.event_page_versions'::regclass
       AND polname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.event_page_versions
      USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END
$$;

-- ── 4. GRANTs para a role de runtime ──────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_page_versions TO eventflow_app;
