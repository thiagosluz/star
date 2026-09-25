-- ═══════════════════════════════════════════════════════════════════════════════
--  CONTATOS PÚBLICOS DA PESSOA — vitrine da equipe (FASE 45)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESCRITA À MÃO (armadilha 53)
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate diff` mistura, com o que é desta fase, RENAME/DROP de índices
--  parciais escritos à mão por fases anteriores (o `schema.prisma` não os declara).
--  Aqui ficou só o que a FASE 45 acrescenta: UMA coluna JSONB em `user`.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE UMA COLUNA, E NÃO UMA TABELA
--  ─────────────────────────────────────────────────────────────────────────────
--  São no máximo quatro links de uma pessoa (`linkedin`, `instagram`, `github` e
--  `youtube`), no mesmo formato do `socialLinks` do palestrante (FASE 25) — que
--  também é JSON. Uma tabela de links traria junção, ordenação e RLS para um dado
--  que é lido SEMPRE junto do perfil, e cujo conjunto de redes é fechado no código.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE NADA DE RLS, GRANT OU BACKFILL
--  ─────────────────────────────────────────────────────────────────────────────
--  `user` é GLOBAL e não tem RLS (decisão da FASE 1), e a concessão é por TABELA —
--  coluna nova herda as duas. O padrão `'{}'` já é o estado correto para quem
--  existe: nenhum contato publicado, porque o campo `contacts` da matriz de
--  visibilidade (FASE 44) nasce FECHADO (ADR-139). Não há o que preencher.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "user"
  ADD COLUMN "publicSocialLinks" JSONB NOT NULL DEFAULT '{}';
