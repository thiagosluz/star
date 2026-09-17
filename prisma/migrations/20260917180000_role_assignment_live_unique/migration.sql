-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 12 — Índice único de concessão de papel vigente (item I5)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O PROBLEMA
--  ─────────────────────────────────────────────────────────────────────────────
--  `role_assignments` acumula concessões, e a revogação é um `revokedAt`. Nada no
--  banco impedia DUAS concessões vigentes idênticas: `grantSuperAdmin` e
--  `applyParticipantLink` checam antes de inserir, mas checagem de aplicação perde
--  para concorrência — dois cliques simultâneos criam duas linhas, e revogar uma
--  deixa a outra valendo (a pessoa continua com o papel depois de "revogado").
--
--  ─────────────────────────────────────────────────────────────────────────────
--  AS TRÊS DECISÕES DESTE ÍNDICE
--  ─────────────────────────────────────────────────────────────────────────────
--  1. PARCIAL (`WHERE "revokedAt" IS NULL`): só concessões VIVAS são únicas.
--     Revogar e conceder de novo — que é o fluxo normal de um papel temporário —
--     continua funcionando, porque a linha revogada sai do índice.
--
--  2. `NULLS NOT DISTINCT` (PostgreSQL 15+; o projeto usa o 18): sem isso, duas
--     concessões de TENANT (`eventId` e `activityId` nulos) NÃO colidiriam, porque
--     em índice único o NULL é distinto por padrão — o índice existiria e não
--     pegaria exatamente o caso mais comum. Também é o que faz a concessão de
--     PLATAFORMA (`tenantId` nulo) ser única por pessoa.
--
--  3. A chave inclui `scope`, `eventId` e `activityId`: o MESMO papel em EVENTOS
--     diferentes é legítimo (staff de dois eventos no mesmo dia), e bloquear isso
--     seria proibir um uso real.
--
--  Escrito à mão porque o Prisma Schema Language não expressa índice parcial nem
--  `NULLS NOT DISTINCT` — mesma razão do `registration_live_unique` da FASE 3.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS "role_assignments_live_unique"
  ON "role_assignments" (
    "tenantId",
    "userId",
    "role",
    "scope",
    "eventId",
    "activityId"
  )
  NULLS NOT DISTINCT
  WHERE "revokedAt" IS NULL;
