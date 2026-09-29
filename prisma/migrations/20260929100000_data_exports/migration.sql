-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 49 — exportação com prazo (`data_exports`)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE A TABELA GUARDA, E O QUE ELA NÃO GUARDA
--  ─────────────────────────────────────────────────────────────────────────────
--  Guarda o ATO da exportação: quem pediu, o tipo, os filtros, quantas linhas, até
--  quando o link vale, quantas vezes foi baixado e se foi revogado. É o "controle de
--  destino" da dívida E44 — a trilha já dizia QUEM exportou (FASE 32), e não dizia
--  mais nada depois disso.
--
--  O ARQUIVO não é guardado em lugar nenhum: o CSV é regerado na hora do download a
--  partir dos filtros. Assim não existe cópia de dado pessoal parada no banco ou no
--  bucket esperando alguém apagar — e é por isso que o prazo faz sentido: o que
--  expira é o DIREITO de baixar de novo.
--
--  Tabela de INSTITUIÇÃO (RLS + FORCE + policy): a exportação é de uma casa, e o
--  link de uma não pode ser usado na outra.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "DataExportKind" AS ENUM ('PARTICIPANTS_CSV', 'SPONSOR_CONTACTS_CSV');

-- CreateTable
CREATE TABLE "data_exports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "kind" "DataExportKind" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_exports_tenantId_requestedById_createdAt_idx" ON "data_exports"("tenantId", "requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "data_exports_tenantId_expiresAt_idx" ON "data_exports"("tenantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: ENABLE + FORCE + policy ──────────────────────────────────────────────
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['data_exports']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', tabela);

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

-- ── GRANTs para a role de runtime ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_exports TO eventflow_app;
