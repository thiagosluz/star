-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 16 — Sorteios de ponta a ponta
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  O que esta migração acrescenta:
--
--    G1  `raffles.alternatesCount` + `raffle_winners.kind`  → suplentes
--    G2  `raffle_winners.deliveredAt/deliveredById/deliveryNote` → entrega do prêmio
--    G3  `raffles.weightByMinutes`                          → sorteio ponderado
--    G4  `raffles.seedCommitment/seedSealed/seedRevealed`   → commit-reveal
--    G5  `raffles.isPublic`                                 → resultado público
--    G6  (nenhuma coluna: paginação é consulta)
--    —   `raffles.resultVersion`                            → payload de auditoria v2
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE `resultVersion` EXISTE
--  ─────────────────────────────────────────────────────────────────────────────
--  Os campos novos entram no CONTEÚDO ASSINADO (o hash SHA-256 do resultado). Se
--  entrassem na versão 1 do payload, o hash de todo sorteio já apurado deixaria de
--  conferir e a trilha antiga viraria "resultado adulterado". O default `1` mantém
--  as apurações existentes verificáveis pela versão 1; as novas usam a 2.
--
--  Migração aplicada UMA vez pelo ledger do `prisma migrate deploy` (sem guardas de
--  idempotência, como nas migrações de particionamento e de vínculo).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Papel da posição sorteada (titular ou suplente) ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RaffleWinnerKind') THEN
    CREATE TYPE "RaffleWinnerKind" AS ENUM ('WINNER', 'ALTERNATE');
  END IF;
END
$$;

ALTER TABLE public.raffle_winners
  ADD COLUMN IF NOT EXISTS kind "RaffleWinnerKind" NOT NULL DEFAULT 'WINNER';

-- ── 2. Entrega do prêmio (G2) ─────────────────────────────────────────────────
ALTER TABLE public.raffle_winners
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "deliveredById" UUID,
  ADD COLUMN IF NOT EXISTS "deliveryNote" VARCHAR(300);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'raffle_winners_deliveredById_fkey'
  ) THEN
    ALTER TABLE public.raffle_winners
      ADD CONSTRAINT "raffle_winners_deliveredById_fkey"
      FOREIGN KEY ("deliveredById") REFERENCES public."user"(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "raffle_winners_raffleId_kind_idx"
  ON public.raffle_winners ("raffleId", "kind");

-- ── 3. Configuração nova do sorteio (G1, G3, G5) e auditoria (G4) ─────────────
ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS "alternatesCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "weightByMinutes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "seedCommitment" CHAR(64),
  ADD COLUMN IF NOT EXISTS "seedSealed" TEXT,
  ADD COLUMN IF NOT EXISTS "seedRevealed" VARCHAR(128),
  -- Default 1: apurações anteriores continuam verificáveis pela versão 1 do payload.
  ADD COLUMN IF NOT EXISTS "resultVersion" INTEGER NOT NULL DEFAULT 1;

-- A página pública busca por evento e visibilidade.
CREATE INDEX IF NOT EXISTS "raffles_eventId_isPublic_status_idx"
  ON public.raffles ("eventId", "isPublic", "status");

-- ── 4. RLS, GRANTs e policies ─────────────────────────────────────────────────
--  `raffles` e `raffle_winners` já têm a coluna `tenantId`, então a policy
--  `tenant_isolation` do loop de introspecção da migração 20260917191000 as cobre —
--  e as colunas novas não mudam isso. As COLUNAS acrescentadas em `raffle_winners`
--  não criam tabela: o contrato de isolamento (`npm run db:verify`) continuaria
--  acusando se alguma tabela nova tivesse nascido sem RLS, e não é o caso.
