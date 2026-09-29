-- ═══════════════════════════════════════════════════════════════════════════════
--  00-roles.sql — Provisionamento de roles
--
--  Executado UMA vez, automaticamente pelo entrypoint da imagem oficial do
--  PostgreSQL, quando o volume de dados está vazio.
--
--  Modelo de duas roles (princípio do menor privilégio):
--
--    eventflow_admin  superuser. DONA do schema e de todas as tabelas.
--                     Usada EXCLUSIVAMENTE pela CLI do Prisma (migrations,
--                     studio, seed). Superuser ignora RLS — é o que garante
--                     que `prisma migrate` enxergue todas as tabelas.
--
--    eventflow_app    role de RUNTIME. NÃO é superuser, NÃO tem BYPASSRLS.
--                     É a conexão usada por Server Components, Server Actions
--                     e pelo worker do BullMQ. Toda query dela passa por RLS.
--
--  Este arquivo NÃO cria tabelas: o DDL é gerado e versionado pelo Prisma
--  Migrate. Aqui criamos apenas roles e GRANTs.
-- ═══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ─── Role de runtime ──────────────────────────────────────────────────────────
-- A senha chega por variável de ambiente interpolada pelo entrypoint.
-- NUNCA use estas credenciais fora de desenvolvimento local.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'eventflow_app') THEN
    CREATE ROLE eventflow_app
      WITH LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS
      CONNECTION LIMIT 100
      PASSWORD 'eventflow_app_password';
  ELSE
    ALTER ROLE eventflow_app WITH PASSWORD 'eventflow_app_password';
  END IF;
END
$$;

-- Garante que a role não possa escapar da RLS nem que alguém a promova por engano.
ALTER ROLE eventflow_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

COMMENT ON ROLE eventflow_app IS
  'Role de runtime da aplicacao EventFlow. Sujeita a Row-Level Security.';

-- ─── Acesso ao banco ──────────────────────────────────────────────────────────
GRANT CONNECT ON DATABASE eventflow TO eventflow_app;

-- ─── Acesso ao schema ─────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO eventflow_app;

-- ─── DML nas tabelas criadas pelo Prisma ──────────────────────────────────────
-- Sem TRUNCATE: a aplicação nunca deve esvaziar tabelas inteiras.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eventflow_app;

-- ─── Sequences (relevante se algum dia trocarmos UUID por bigserial) ──────────
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eventflow_app;

-- ─── Funções (introspecção e extensões) ───────────────────────────────────────
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO eventflow_app;

-- ─── Default privileges ───────────────────────────────────────────────────────
-- CRÍTICO: as tabelas são criadas DEPOIS deste script, pelo `prisma migrate`
-- rodando como eventflow_admin. Sem os ALTER DEFAULT PRIVILEGES abaixo, a role
-- de runtime não teria permissão alguma nas tabelas recém-criadas.
--
-- O PostgreSQL também concede estes privilégios retroativamente às tabelas
-- existentes, portanto esta seção torna os GRANTs acima redundantes — o que é
-- intencional, como documentação executável.
ALTER DEFAULT PRIVILEGES FOR ROLE eventflow_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eventflow_app;

ALTER DEFAULT PRIVILEGES FOR ROLE eventflow_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eventflow_app;

ALTER DEFAULT PRIVILEGES FOR ROLE eventflow_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO eventflow_app;

-- ─── Tabelas de PLATAFORMA e de IDENTIDADE: a role de runtime NÃO alcança ────
--
-- O GRANT acima é "em TODAS as tabelas" e o ALTER DEFAULT PRIVILEGES vale também
-- para as que ainda vão nascer — inclusive as de PLATAFORMA e as de IDENTIDADE.
--
--   • `job_runs` (FASE 36): não tem `tenantId` (uma passada de rotina atende todas as
--     instituições), então não há RLS possível, e alcançável pelo runtime ela exporia
--     o histórico operacional (host, erro, rotina) e permitiria TRAVAR uma rotina
--     inserindo uma linha `RUNNING`.
--   • `two_factor` (FASE 47): guarda a semente TOTP e os códigos de recuperação —
--     quem lê, GERA códigos válidos.
--   • `identity_audit_logs` (FASE 49): a trilha de segurança da conta. Quem pode
--     apagá-la pode apagar o rastro de uma invasão.
--
-- ─── POR QUE O REVOKE PRECISA ESTAR AQUI, E NÃO SÓ NA MIGRAÇÃO ────────────────
--  Este arquivo é REEXECUTADO por `npm run db:rls`, e todo `npm run db:migrate:deploy`
--  termina nele (o initdb do container só roda no primeiro boot, então o projeto
--  reaplica as policies pelo script). O `GRANT ... ON ALL TABLES` da linha 59 passa
--  por cima do REVOKE que a migração fez — foi exatamente o que aconteceu na primeira
--  versão da FASE 36: a migração revogou, o `db:migrate:deploy` reconcedeu, e a
--  verificação de contrato reprovou com a abertura de volta.
--
--  **E ACONTECEU DE NOVO NA FASE 47**, porque só `job_runs` estava nesta lista: a
--  FASE 49 provou o defeito rodando `npm run db:rls` e vendo o contrato reprovar em
--  `two_factor` — o privilégio voltava a cada `db:setup`. Por isso a lista passou a ser
--  um ARRAY: acrescentar tabela nova é acrescentar um nome, e não escrever mais um
--  bloco que alguém vai esquecer.
--
--  O `to_regclass` existe porque na PRIMEIRA subida do container as tabelas ainda não
--  existem (o initdb roda antes das migrações) — e `REVOKE` em relação inexistente é
--  erro. Nesse caso as migrações (`20260923154500_job_runs_platform_only`,
--  `20260927180000_two_factor` e `20260929110000_identity_audit_logs`) fazem a revogação.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['job_runs', 'two_factor', 'identity_audit_logs']
  LOOP
    IF to_regclass('public.' || tabela) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM eventflow_app', tabela);
    END IF;
  END LOOP;
END
$$;

-- ─── Isolamento do schema de templates ────────────────────────────────────────
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ─── Verificação ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_super boolean;
  v_bypass boolean;
BEGIN
  SELECT rolsuper, rolbypassrls INTO v_super, v_bypass
  FROM pg_catalog.pg_roles WHERE rolname = 'eventflow_app';

  IF v_super OR v_bypass THEN
    RAISE EXCEPTION
      'FALHA DE SEGURANCA: eventflow_app tem superuser=% bypassrls=% — RLS nao protegeria nada.',
      v_super, v_bypass;
  END IF;

  RAISE NOTICE '[OK] role eventflow_app criada sem superuser e sem BYPASSRLS.';
END
$$;
