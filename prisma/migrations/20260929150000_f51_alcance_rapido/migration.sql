-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 51 — Alcance rápido e fechamento da FASE 49 (Blocos 3 e 4)
--
--  Cinco colunas, cinco dívidas que precisavam de DADO antes de tela:
--    • E70 — validade opcional e contador de acessos do link da carta;
--    • E37 — interruptor do telão do sorteio;
--    • E63 — ordem manual das equipes na vitrine pública;
--    • E66 — a DECLARAÇÃO de autorização da foto (texto, versão, canal e data);
--    • E42 — a categoria do crachá (a faixa de cor da etiqueta).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  TUDO É ADITIVO, E COM PADRÃO QUE PRESERVA O QUE EXISTE
--  ─────────────────────────────────────────────────────────────────────────────
--  Nenhuma coluna é NOT NULL sem padrão, nenhuma linha antiga muda de sentido:
--    • `expiresAt`/`lastViewedAt`/`photoAuthorization*` nascem NULAS (a ausência é a
--      informação: "não expira", "foto sem declaração guardada", "publicada antes
--      desta fase");
--    • `viewCount` e `displayOrder` nascem ZERO;
--    • `bigscreenVisible` nasce LIGADO (o telão de quem já usava continua no ar);
--    • `category` nasce `PARTICIPANT` (o crachá que já existe continua igual).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── E70 — o link da carta: prazo opcional e medição de acessos ───────────────
ALTER TABLE "card_share_links"
  ADD COLUMN IF NOT EXISTS "expiresAt"    TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "viewCount"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastViewedAt" TIMESTAMPTZ(6);

-- ─── E37 — o telão do sorteio tem interruptor ─────────────────────────────────
ALTER TABLE "raffles"
  ADD COLUMN IF NOT EXISTS "bigscreenVisible" BOOLEAN NOT NULL DEFAULT true;

-- ─── E63 — ordem manual das equipes na vitrine ────────────────────────────────
ALTER TABLE "event_teams"
  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- ─── E66 — a declaração de autorização da foto passa a ser GUARDADA ───────────
ALTER TABLE "speaker_profiles"
  ADD COLUMN IF NOT EXISTS "photoAuthorizationText"    TEXT,
  ADD COLUMN IF NOT EXISTS "photoAuthorizationVersion" VARCHAR(8),
  ADD COLUMN IF NOT EXISTS "photoAuthorizationChannel" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "photoAuthorizationAt"      TIMESTAMPTZ(6);

-- ─── E42 — a categoria do crachá (a cor da faixa na etiqueta) ─────────────────
ALTER TABLE "event_credentials"
  ADD COLUMN IF NOT EXISTS "category" VARCHAR(20) NOT NULL DEFAULT 'PARTICIPANT';

-- Índice de apoio: a folha de impressão e a lista de crachás filtram por categoria.
CREATE INDEX IF NOT EXISTS "event_credentials_category_idx"
  ON "event_credentials" ("tenantId", "eventId", "category");
