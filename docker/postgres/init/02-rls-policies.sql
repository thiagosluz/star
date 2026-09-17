-- ═══════════════════════════════════════════════════════════════════════════════
--  AS POLICIES DE RLS MUDARAM DE LUGAR (FASE 13, item B2)
-- ═══════════════════════════════════════════════════════════════════════════════
--  Este arquivo continha a criação das policies. Ele existia em
--  `docker/postgres/init/`, que o PostgreSQL executa APENAS na primeira
--  inicialização do volume — ou seja, um banco novo só ganhava RLS se alguém
--  lembrasse de rodar `npm run db:rls`.
--
--  Agora as policies vivem em uma MIGRAÇÃO:
--
--      prisma/migrations/20260917191000_rls_policies/migration.sql
--
--  e são aplicadas por `prisma migrate deploy` (ou por `npm run db:rls`, que
--  reaplica o mesmo SQL depois de criar tabelas novas). Uma fonte só.
--
--  Este arquivo permanece apenas para que uma instalação antiga — que ainda tenha
--  o volume anterior — encontre a explicação em vez de um silêncio.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '[INFO] As policies de RLS agora são aplicadas pela migração 20260917191000_rls_policies.';
END $$;
