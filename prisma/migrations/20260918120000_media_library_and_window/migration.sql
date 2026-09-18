-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 24 — Mídia e agendamento
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  O que esta migração acrescenta:
--
--    E14  tabela `media_assets`              → a imagem passa a ter REGISTRO
--    E15  `sponsors."sourceSponsorId"`       → vínculo com a edição de origem
--    E16  `event_pages."unpublishAt"`        → janela de exibição (saída automática)
--
--  E17 (fuso do agendamento) é só código: a data/hora passou a ser interpretada no
--  fuso do EVENTO em vez do fuso do processo.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE A JANELA DE EXIBIÇÃO É DECIDIDA NA LEITURA, COMO A ENTRADA
--  ─────────────────────────────────────────────────────────────────────────────
--  `publishAt` (FASE 23) já entra no ar sozinho porque a consulta pública compara
--  a data com `now()`. `unpublishAt` segue o mesmo caminho pelo motivo simétrico:
--  um agendador que não roda deixaria a campanha no ar DEPOIS do prazo — e uma
--  promoção vencida publicada é pior do que uma promoção atrasada.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  RLS DA TABELA NOVA
--  ─────────────────────────────────────────────────────────────────────────────
--  `media_assets` tem `tenantId`, então precisa de ENABLE + FORCE + policy. Como a
--  tabela nasce NESTA migração (depois do loop de introspecção da 20260917191000),
--  a policy é criada aqui — o mesmo bloco daquela migração — e o `npm run db:verify`
--  confirma.
--
--  Migração aplicada UMA vez pelo ledger do `prisma migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Janela de exibição (E16) ───────────────────────────────────────────────
ALTER TABLE public.event_pages
  ADD COLUMN IF NOT EXISTS "unpublishAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "event_pages_tenantId_eventId_unpublishAt_idx"
  ON public.event_pages ("tenantId", "eventId", "unpublishAt");

-- ── 2. Origem do cadastro de patrocinador (E15) ───────────────────────────────
ALTER TABLE public.sponsors
  ADD COLUMN IF NOT EXISTS "sourceSponsorId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_sourceSponsorId_fkey'
  ) THEN
    ALTER TABLE public.sponsors
      ADD CONSTRAINT "sponsors_sourceSponsorId_fkey"
      FOREIGN KEY ("sourceSponsorId") REFERENCES public.sponsors(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "sponsors_sourceSponsorId_idx"
  ON public.sponsors ("sourceSponsorId");

-- ── 3. Biblioteca de mídia (E14) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_assets (
  id            UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"    UUID           NOT NULL,
  "eventId"     UUID,
  bucket        VARCHAR(120)   NOT NULL,
  "objectKey"   VARCHAR(1024)  NOT NULL,
  url           VARCHAR(1024)  NOT NULL,
  "fileName"    VARCHAR(300)   NOT NULL,
  "mimeType"    VARCHAR(120)   NOT NULL,
  "sizeBytes"   INTEGER        NOT NULL,
  checksum      CHAR(64)       NOT NULL,
  target        VARCHAR(32)    NOT NULL,
  "uploadedById" UUID,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt"   TIMESTAMPTZ(6),

  CONSTRAINT media_assets_pkey PRIMARY KEY (id),
  CONSTRAINT "media_assets_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  -- O evento pode ser removido sem levar o acervo da instituição: a imagem passa a
  -- ser do acervo geral (eventId nulo) em vez de sumir do registro.
  CONSTRAINT "media_assets_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES public.events(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "media_assets_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES public."user"(id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_tenantId_objectKey_key"
  ON public.media_assets ("tenantId", "objectKey");

CREATE INDEX IF NOT EXISTS "media_assets_tenantId_createdAt_idx"
  ON public.media_assets ("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "media_assets_tenantId_eventId_idx"
  ON public.media_assets ("tenantId", "eventId");

CREATE INDEX IF NOT EXISTS "media_assets_tenantId_checksum_idx"
  ON public.media_assets ("tenantId", "checksum");

-- ── 4. RLS: ENABLE + FORCE + policy de isolamento (tabela nova) ───────────────
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.media_assets'::regclass
       AND polname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.media_assets
      USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END
$$;

-- ── 5. GRANTs para a role de runtime ──────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO eventflow_app;
