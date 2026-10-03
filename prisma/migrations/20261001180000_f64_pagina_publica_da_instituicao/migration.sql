-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 64 — PÁGINA PÚBLICA DA INSTITUIÇÃO (fatia 1 · fundação)
--
--  Cria `tenant_public_pages`: UMA página por instituição, com o rascunho e a
--  versão publicada na MESMA linha (ver o comentário do modelo no schema.prisma).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  RLS + FORCE — e por que a policy NÃO está neste arquivo
--  ─────────────────────────────────────────────────────────────────────────────
--  A policy `tenant_isolation` é criada por INTROSPECÇÃO em
--  `20260917191000_rls_policies/migration.sql`: toda tabela com a coluna `tenantId`
--  recebe ENABLE + FORCE + a policy. Isso é deliberado desde a FASE 8 — uma lista de
--  tabelas escrita à mão é uma lista que alguém esquece de atualizar, e uma tabela
--  com RLS habilitada e SEM policy é fail-closed (a aplicação não lê nada).
--
--  Ainda assim o FORCE vai EXPLÍCITO aqui: `npm run db:verify` lê o catálogo do
--  banco, e o `npm run db:rls` (que aplicaria a policy) é um passo separado do
--  `prisma migrate`. Assim a tabela nasce no estado correto mesmo entre os dois
--  comandos, e o contrato não depende da ordem de execução.
--
--  ⚠ O FORCE importa mais do que o ENABLE: sem ele o DONO da tabela
--  (`eventflow_admin`) ignora a policy — e é justamente a role que o seed e as CLIs
--  usam. Com FORCE, nem o dono passa por cima do isolamento.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "tenant_public_pages" (
  -- Sem DEFAULT: o id é UUID v7, gerado pelo Prisma na aplicação (a mesma escolha de
  -- todas as outras tabelas do projeto — `gen_random_uuid()` produziria v4, e a
  -- ordenação temporal do v7 é o que faz o índice do id ficar denso).
  "id"                UUID            NOT NULL,
  "tenantId"          UUID            NOT NULL,

  -- Rascunho: o que o editor monta.
  "title"             VARCHAR(200)    NOT NULL,
  "description"       TEXT,
  "coverImageUrl"     VARCHAR(1024),
  "logoUrl"           VARCHAR(1024),
  "theme"             JSONB           NOT NULL DEFAULT '{}',
  "blocks"            JSONB           NOT NULL DEFAULT '[]',

  -- Publicado: a versão que os visitantes veem. `{}` = nunca publicada (ver o
  -- comentário do modelo: um snapshot sem título não é um snapshot).
  "publishedSnapshot" JSONB           NOT NULL DEFAULT '{}',
  "publishedAt"       TIMESTAMPTZ(6),
  "publishedById"     UUID,

  "createdAt"         TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_public_pages_pkey" PRIMARY KEY ("id")
);

-- UMA página por instituição: nem a leitura pública nem o editor escolhem entre linhas.
CREATE UNIQUE INDEX "tenant_public_pages_tenantId_key"
  ON "tenant_public_pages" ("tenantId");

CREATE INDEX "tenant_public_pages_publishedById_idx"
  ON "tenant_public_pages" ("publishedById");

ALTER TABLE "tenant_public_pages"
  ADD CONSTRAINT "tenant_public_pages_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_public_pages"
  ADD CONSTRAINT "tenant_public_pages_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Isolamento (a policy vem do arquivo de RLS por introspecção — ver o cabeçalho).
ALTER TABLE "tenant_public_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_public_pages" FORCE ROW LEVEL SECURITY;

-- Concessões da role de runtime. Os privilégios padrão do banco já concedem CRUD às
-- tabelas novas; declarar aqui deixa a intenção explícita e não depende de `ALTER
-- DEFAULT PRIVILEGES` de um volume antigo. TRUNCATE fica de fora de propósito — o
-- contrato (`assert-schema-contract.mjs`) reprova a role que puder truncar.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_public_pages" TO eventflow_app;
