-- ═══════════════════════════════════════════════════════════════════════════════
--  MODELO VISUAL DO CERTIFICADO — arte de fundo e layout (FASE 40)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESCRITA À MÃO (armadilha 53)
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate dev --create-only` foi rodado para conferir o diff e os NOMES
--  (coluna, índice e constraint), e o arquivo gerado trazia, além do que é desta
--  fase:
--
--    • DROP INDEX dos índices PARCIAIS escritos à mão por fases anteriores (o
--      `schema.prisma` não os declara, então o Prisma os considera sobras);
--    • `ALTER COLUMN "id"/"updatedAt" DROP DEFAULT` em sete tabelas antigas;
--    • dezenas de RENAME CONSTRAINT/RENAME INDEX de outros módulos.
--
--  Nada disso é desta fase, e aplicar qualquer uma dessas linhas seria desfazer
--  decisão de outra fase em silêncio. Ficou só o que a FASE 40 acrescenta.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE A EXCLUSIVIDADE DO MODELO É ÍNDICE PARCIAL
--  ─────────────────────────────────────────────────────────────────────────────
--  A precedência do modelo é EVENTO+TIPO → EVENTO → INSTITUIÇÃO+TIPO → INSTITUIÇÃO
--  → PADRÃO do código, e `NULL` significa "não especificado NESTE nível". O
--  PostgreSQL trata NULLs como DISTINTOS em índice único, então um
--  `UNIQUE (tenantId, eventId, kind)` permitiria DOIS modelos para o mesmo par — e a
--  escolha do desenho passaria a depender da ordem em que as linhas voltassem. Os
--  quatro índices parciais abaixo fecham cada combinação por si, e o banco decide
--  (invariante nº 5).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  SEM BACKFILL
--  ─────────────────────────────────────────────────────────────────────────────
--  Certificado emitido ANTES desta fase não tem layout e continua sendo renderizado
--  pelo desenho fixo da FASE 6: `layoutSnapshot` nulo é o que identifica a versão 1
--  do documento (o conteúdo assinado dela não muda).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Tabela do modelo visual ────────────────────────────────────────────────
CREATE TABLE "certificate_templates" (
    "id"              UUID           NOT NULL,
    "tenantId"        UUID           NOT NULL,
    "eventId"         UUID,
    "kind"            "CertificateKind",
    "name"            VARCHAR(120)   NOT NULL,
    "layout"          JSONB          NOT NULL,
    "backgroundBytes" BIGINT,
    "createdById"     UUID,
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "certificate_templates_tenantId_eventId_kind_idx"
  ON "certificate_templates" ("tenantId", "eventId", "kind");

-- ── 2. UM modelo por combinação de especificidade ─────────────────────────────
CREATE UNIQUE INDEX "certificate_templates_event_kind_key"
  ON "certificate_templates" ("tenantId", "eventId", "kind")
  WHERE "eventId" IS NOT NULL AND "kind" IS NOT NULL;

CREATE UNIQUE INDEX "certificate_templates_event_key"
  ON "certificate_templates" ("tenantId", "eventId")
  WHERE "eventId" IS NOT NULL AND "kind" IS NULL;

CREATE UNIQUE INDEX "certificate_templates_kind_key"
  ON "certificate_templates" ("tenantId", "kind")
  WHERE "eventId" IS NULL AND "kind" IS NOT NULL;

CREATE UNIQUE INDEX "certificate_templates_institution_key"
  ON "certificate_templates" ("tenantId")
  WHERE "eventId" IS NULL AND "kind" IS NULL;

-- ── 3. Chaves estrangeiras ────────────────────────────────────────────────────
ALTER TABLE "certificate_templates"
  ADD CONSTRAINT "certificate_templates_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "certificate_templates"
  ADD CONSTRAINT "certificate_templates_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quem criou o modelo sai da plataforma sem levar o desenho da instituição junto.
ALTER TABLE "certificate_templates"
  ADD CONSTRAINT "certificate_templates_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. O certificado passa a guardar o desenho que usou ───────────────────────
ALTER TABLE "certificates"
  ADD COLUMN "layoutSnapshot"   JSONB,
  ADD COLUMN "templateId"       UUID,
  ADD COLUMN "variableSnapshot" JSONB;

ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "certificate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Excluir um modelo percorre os certificados que o usaram: sem este índice, a
-- varredura seria sequencial na maior tabela de documentos da instituição.
CREATE INDEX "certificates_templateId_idx" ON "certificates" ("templateId");

-- ── 5. RLS: ENABLE + FORCE + policy ───────────────────────────────────────────
ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificate_templates FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.certificate_templates'::regclass
       AND polname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.certificate_templates
      USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END
$$;

-- ── 6. GRANTs para a role de runtime ──────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificate_templates TO eventflow_app;
