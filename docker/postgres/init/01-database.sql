-- ═══════════════════════════════════════════════════════════════════════════════
--  01-database.sql — Schema, extensões e configuração do banco
-- ═══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ─── Extensões ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";     -- fallback de geração de UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "citext";        -- e-mails/domínios case-insensitive
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- busca fuzzy em títulos/abstracts
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- busca sem acento (pt-BR)

-- ─── Schema único ─────────────────────────────────────────────────────────────
-- Optamos por um único schema `public` compartilhado por todos os tenants.
-- O isolamento NÃO é feito por schema/database, e sim por RLS (ver ADR-001).
ALTER DATABASE eventflow SET search_path TO public;

-- ─── Parâmetros de sessão ─────────────────────────────────────────────────────
-- Timeout defensivo: nenhuma query de tenant deve segurar uma conexão.
ALTER DATABASE eventflow SET statement_timeout TO '30s';
ALTER DATABASE eventflow SET idle_in_transaction_session_timeout TO '60s';
ALTER DATABASE eventflow SET lock_timeout TO '10s';

-- Registra o fuso canônico da plataforma.
ALTER DATABASE eventflow SET timezone TO 'UTC';

DO $$ BEGIN RAISE NOTICE '[OK] banco eventflow provisionado (extensoes + parametros).'; END $$;
