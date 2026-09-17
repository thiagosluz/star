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
