-- ═══════════════════════════════════════════════════════════════════════════════
--  PERFIL PÚBLICO DO PARTICIPANTE — visibilidade por campo (FASE 44)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESCRITA À MÃO (armadilha 53)
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate diff` gera, junto do que é desta fase, RENAME/DROP de índices
--  parciais escritos à mão por fases anteriores (o `schema.prisma` não os declara).
--  Aqui ficou só o que a FASE 44 acrescenta: colunas em duas tabelas existentes e
--  UM índice único que o Prisma não sabe declarar.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O ÍNDICE ÚNICO QUE O `@unique` NÃO RESOLVE
--  ─────────────────────────────────────────────────────────────────────────────
--  `users.publicHandle` já é `@unique`, e isso é unicidade EXATA: `Ana` e `ana`
--  seriam dois handles diferentes para a mesma pessoa — e quem digita o endereço
--  não diferencia maiúscula de minúscula. O domínio normaliza para minúsculas, mas
--  normalizar só na aplicação é confiar em quem escreve: o índice sobre `lower(...)`
--  é o que faz a unicidade *case-insensitive* valer TAMBÉM para uma escrita futura
--  que esqueça a regra (invariante 5 — a decisão é do banco).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE NADA NOVO DE RLS
--  ─────────────────────────────────────────────────────────────────────────────
--  `users` é GLOBAL e não tem RLS (decisão da FASE 1); `user_tenant_profiles` já é
--  tenant-scoped com policy e FORCE, e coluna nova herda a policy da tabela. As
--  concessões são de tabela, então também não há GRANT a refazer.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. A decisão de visibilidade e o que a pessoa declara (global) ────────────
-- A tabela de identidade chama-se `user` (o modelo `User` não tem `@@map`), e não
-- `users`: é o nome que as migrações anteriores usam nas chaves estrangeiras.
ALTER TABLE "user"
  ADD COLUMN "profileAudiences"   JSONB        NOT NULL DEFAULT '{}',
  ADD COLUMN "publicInterests"    TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "publicSiteUrl"      VARCHAR(1024),
  ADD COLUMN "profileIndexable"   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN "usernameChangedAt"  TIMESTAMPTZ(6);

-- ── 2. O que só faz sentido dentro de UMA instituição ────────────────────────
ALTER TABLE "user_tenant_profiles"
  ADD COLUMN "listedInDirectory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicEventIds"    TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ── 3. Unicidade do handle sem depender de maiúscula ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "user_publicHandle_lower_key"
  ON "user" (lower("publicHandle"))
  WHERE "publicHandle" IS NOT NULL;
