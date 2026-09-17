-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 13 — `audit_logs` PARTICIONADA POR MÊS
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  ───────
--  `audit_logs` é a única tabela do sistema que cresce para sempre: não há
--  exclusão, não há arquivamento, e cada operação sensível grava uma linha. Em
--  dois anos de operação ela é a maior tabela do banco — e uma tabela grande sem
--  partição tem três custos concretos: `VACUUM`/`ANALYZE` sobre o histórico
--  inteiro, índices que não cabem mais em memória, e descarte de dado antigo que
--  exige `DELETE` massivo (que incha a tabela em vez de devolver espaço).
--
--  Com partição mensal, descartar 2026 é `DROP TABLE audit_logs_2026_09` —
--  instantâneo, sem bloat — e cada índice passa a ter o tamanho de um mês.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  A ARMADILHA DA CHAVE PRIMÁRIA (por que o schema mudou junto)
--  ─────────────────────────────────────────────────────────────────────────────
--  No PostgreSQL a chave de particionamento TEM de fazer parte de toda chave
--  única/PK da tabela particionada. Como a partição é por `createdAt`, a PK vira
--  `(id, createdAt)` — e isso não é um detalhe de DDL, é uma restrição que sobe
--  até o Prisma: `@@id([id, createdAt])` no schema e nenhum `findUnique({ id })`
--  em `audit_logs` (não existe: as consultas usam `findMany`/`create`). Nenhuma
--  FK aponta para `audit_logs`, então não há referência a reescrever.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE ESTA MIGRAÇÃO NÃO ESTÁ EM `DO $$ ... $$`
--  ─────────────────────────────────────────────────────────────────────────────
--  As migrações de RLS usam blocos `DO` com guardas porque o script
--  `prisma/scripts/apply-rls.mjs` as REAPLICA a cada `npm run db:rls`. Esta é
--  aplicada uma única vez, pelo ledger do `prisma migrate deploy`; guardas de
--  idempotência aqui só esconderiam erro de digitação.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. O legado sai do caminho (mantendo os dados) ────────────────────────────
--  O nome dos índices é global no schema, então `audit_logs_pkey` precisa
--  desaparecer antes de a tabela nova reivindicar o mesmo nome. Por isso o
--  `DROP TABLE` do legado acontece ANTES de criar PK/índices da nova tabela.
ALTER TABLE public.audit_logs RENAME TO audit_logs_legacy;

-- ── 2. Tabela nova: mesma forma, particionada por mês ─────────────────────────
--  `LIKE ... INCLUDING DEFAULTS INCLUDING CONSTRAINTS` copia tipos, defaults
--  (`changes = '{}'`, `createdAt = now()`) e NOT NULL direto da definição real —
--  em vez de uma lista escrita à mão que diverge em silêncio. `INCLUDING
--  INDEXES` não é permitido em tabela particionada e não é desejado: os índices
--  são criados no passo 6.
CREATE TABLE public.audit_logs (
  LIKE public.audit_logs_legacy INCLUDING DEFAULTS INCLUDING CONSTRAINTS
) PARTITION BY RANGE ("createdAt");

-- ── 3. Partições: um mês para cada mês existente no legado, mais o atual e o
--       próximo (o resto é responsabilidade de `npm run db:partitions`) ─────────
DO $$
DECLARE
  mes date;
  nome text;
BEGIN
  FOR mes IN
    SELECT DISTINCT date_trunc('month', "createdAt")::date FROM public.audit_logs_legacy
    UNION
    SELECT date_trunc('month', now())::date
    UNION
    SELECT (date_trunc('month', now()) + interval '1 month')::date
    ORDER BY 1
  LOOP
    nome := format('audit_logs_%s', to_char(mes, 'YYYY_MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
      nome, mes, (mes + interval '1 month')::date
    );
    RAISE NOTICE '[OK] partição % criada.', nome;
  END LOOP;
END
$$;

--  Partição DEFAULT: auditoria é registro de segurança, não métrica — gravar uma
--  linha de auditoria NUNCA pode falhar por falta de partição (o caminho de
--  escrita é o mesmo da operação auditada). Ela recebe o que não tiver faixa
--  própria e o script mensal a esvazia ao criar a partição definitiva.
CREATE TABLE IF NOT EXISTS public.audit_logs_default
  PARTITION OF public.audit_logs DEFAULT;

-- ── 4. Cópia dos dados ────────────────────────────────────────────────────────
INSERT INTO public.audit_logs (
  id, "tenantId", "userId", action, "entityType", "entityId",
  changes, "ipAddress", "userAgent", "requestId", "createdAt"
)
SELECT
  id, "tenantId", "userId", action, "entityType", "entityId",
  changes, "ipAddress", "userAgent", "requestId", "createdAt"
FROM public.audit_logs_legacy;

-- ── 5. O legado pode ir embora (leva junto os índices com nome em conflito) ────
DROP TABLE public.audit_logs_legacy;

-- ── 6. Chaves, índices e FKs da tabela particionada ──────────────────────────
--  A PK inclui `createdAt` porque é a chave de particionamento (ver cabeçalho).
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id, "createdAt");

--  FK de saída: a tabela particionada referencia tabelas comuns (suportado desde
--  o PostgreSQL 12). Não existe FK apontando PARA `audit_logs` — era o requisito
--  para poder particionar sem reescrever nenhum outro modelo.
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_tenantId_fkey FOREIGN KEY ("tenantId")
  REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_userId_fkey FOREIGN KEY ("userId")
  REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;

--  Os três índices do schema: criados no pai e propagados para as partições
--  existentes e futuras.
CREATE INDEX "audit_logs_tenantId_createdAt_idx"
  ON public.audit_logs ("tenantId", "createdAt");
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx"
  ON public.audit_logs ("tenantId", "entityType", "entityId");
CREATE INDEX "audit_logs_userId_createdAt_idx"
  ON public.audit_logs ("userId", "createdAt");

-- ── 7. RLS: reconstruída (a tabela antiga levou a policy embora) ──────────────
--  A policy é a mesma que `20260917191000_rls_policies` cria por introspecção
--  (`tenant_isolation`, `"tenantId" = app_current_tenant_id()`). Ela é recriada
--  aqui porque DROP TABLE descarta policies, e um banco criado do zero por
--  `prisma migrate deploy` precisa terminar este passo sob RLS.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.audit_logs;
CREATE POLICY tenant_isolation ON public.audit_logs
  FOR ALL
  TO eventflow_app
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

--  As partições também ficam sob RLS: o acesso pela tabela pai já é filtrado pela
--  policy do pai, mas uma query que cite a partição pelo nome (o que a aplicação
--  nunca faz) encontraria dados de todos os tenants se a filha não tivesse
--  policy própria. Defesa em profundidade, custo zero.
DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition
      AND c.relname LIKE 'audit_logs%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', p);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', p);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO eventflow_app
        USING ("tenantId" = app_current_tenant_id())
        WITH CHECK ("tenantId" = app_current_tenant_id())
    $f$, p);
  END LOOP;
END
$$;

-- ── 8. Privilégios ───────────────────────────────────────────────────────────
--  Os `ALTER DEFAULT PRIVILEGES` da role admin (`docker/postgres/init/00-roles.sql`)
--  já cobrem tabelas novas, inclusive partições. Os GRANTs explícitos existem
--  para o caso de o banco ter sido criado por outro caminho (restore, cópia sem
--  os scripts de init) — e para deixar a intenção escrita.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs_default TO eventflow_app;

DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition
      AND c.relname LIKE 'audit_logs%'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO eventflow_app', p);
  END LOOP;
END
$$;
