-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 33 — Chamadas de propostas (call for proposals)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE ESTA MIGRAÇÃO FOI ESCRITA À MÃO (armadilha 53, de novo)
--  ─────────────────────────────────────────────────────────────────────────────
--  O `prisma migrate dev --create-only` propôs, junto com o que a fase precisa:
--
--    • DROP dos quatro índices criados à mão (`event_pages_tenantId_eventId_unpublishAt_idx`,
--      `raffle_winners_raffleId_kind_idx`, `raffles_eventId_isPublic_status_idx`,
--      `registrations_event_origin_idx`) — o `schema.prisma` não os declara (são
--      parciais), então o Prisma os vê como sobra;
--    • remoção do default (`uuid_generate_v7()`) de sete colunas de tabelas alheias;
--    • uma dúzia de RENAME de constraint e de índice (cosmético, mas ruído no histórico).
--
--  Nada disso é desta fase. Aqui ficou SÓ o que ela pede:
--    1. o enum `ProposalKind`;
--    2. a tabela `call_for_proposals`;
--    3. duas colunas em `submissions` (`callId` e `proposalData`);
--    4. os índices que as duas coisas usam.
--
--  A coluna `callId` é NULÁVEL de propósito: TODA submissão anterior a esta fase fica
--  sem chamada (legado) e continua avaliável como sempre foi.
--
--  RLS: a policy da tabela nova vem do `npm run db:rls` (introspecção, armadilha 2), e
--  `npm run db:verify` reprova se faltar.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. O tipo de proposta ──────────────────────────────────────────────────────
CREATE TYPE "ProposalKind" AS ENUM ('PAPER', 'SPEAKER', 'MINICOURSE', 'WORKSHOP', 'ROUNDTABLE', 'POSTER', 'OTHER');

-- ── 2. A chamada ───────────────────────────────────────────────────────────────
CREATE TABLE "call_for_proposals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "summary" TEXT,
    "instructions" TEXT,
    "opensAt" TIMESTAMPTZ(6),
    "closesAt" TIMESTAMPTZ(6),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "requiresBlindReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewRubric" JSONB NOT NULL DEFAULT '[]',
    "maxSubmissionsPerAuthor" INTEGER NOT NULL DEFAULT 0,
    "trackId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_for_proposals_pkey" PRIMARY KEY ("id")
);

-- Uma chamada por identificador de URL DENTRO do evento (o slug é o endereço público).
CREATE UNIQUE INDEX "call_for_proposals_eventId_slug_key" ON "call_for_proposals"("eventId", "slug");

-- O bloco da página pública e o painel listam por evento, quase sempre filtrando as
-- publicadas — daí a ordem das colunas.
CREATE INDEX "call_for_proposals_tenantId_eventId_isPublished_idx" ON "call_for_proposals"("tenantId", "eventId", "isPublished");
CREATE INDEX "call_for_proposals_tenantId_kind_idx" ON "call_for_proposals"("tenantId", "kind");

ALTER TABLE "call_for_proposals" ADD CONSTRAINT "call_for_proposals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_for_proposals" ADD CONSTRAINT "call_for_proposals_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- `SET NULL`: excluir a trilha não pode apagar a chamada — ela volta a avaliar pela
-- rubrica padrão (a mesma degradação declarada de `resolveRubric`).
ALTER TABLE "call_for_proposals" ADD CONSTRAINT "call_for_proposals_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "call_for_proposals" ADD CONSTRAINT "call_for_proposals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "call_for_proposals" IS
  'Chamada de propostas do evento (FASE 33): artigo, palestrante, minicurso e afins, cada uma com o proprio tipo e a propria janela.';
COMMENT ON COLUMN "call_for_proposals"."opensAt" IS
  'Abertura da janela. O estado da chamada e CALCULADO na leitura (callStateOf) - nao ha agendador abrindo chamada.';
COMMENT ON COLUMN "call_for_proposals"."reviewRubric" IS
  'Rubrica propria da chamada. Vazia = usa a da trilha, e a padrao quando nao ha trilha.';

-- ── 3. A proposta é uma SUBMISSION (o motor de avaliação é o mesmo) ────────────
ALTER TABLE "submissions" ADD COLUMN "callId" UUID;
ALTER TABLE "submissions" ADD COLUMN "proposalData" JSONB NOT NULL DEFAULT '{}';

-- `SET NULL` e não `CASCADE`: apagar uma chamada não pode apagar as propostas que ela
-- recebeu (o comitê já pode ter dado parecer nelas). Elas ficam como legado da chamada,
-- exatamente como os artigos anteriores a esta fase.
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_for_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O painel da chamada conta e lista propostas por (instituição, chamada, situação).
CREATE INDEX "submissions_tenantId_callId_status_idx" ON "submissions"("tenantId", "callId", "status");

COMMENT ON COLUMN "submissions"."callId" IS
  'Chamada de origem da proposta (FASE 33). NULO = artigo submetido antes das chamadas (legado).';
COMMENT ON COLUMN "submissions"."proposalData" IS
  'Campos especificos do TIPO de chamada (carga horaria, publico-alvo, minibio...), validados por validateProposalData.';
