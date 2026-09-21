-- ═══════════════════════════════════════════════════════════════════════════════
--  RODADAS DE APURAÇÃO (FASE 30)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE MUDA, E POR QUÊ
--  ─────────────────────────────────────────────────────────────────────────────
--  O sorteio tinha UMA apuração. A operação pediu o que o palco faz de verdade:
--  sortear em MOMENTOS separados — o primeiro brinde agora, o segundo depois do
--  intervalo —, cada momento com o seu prêmio, o seu patrocinador e a sua prova.
--
--  A prova NÃO pode ser uma só: a semente é revelada em cada apuração, então quem
--  lesse a revelação da primeira rodada calcularia os ganhadores das seguintes. Cada
--  rodada tem o seu compromisso (`seedCommitment`), publicado ANTES dela, o seu selo
--  e a sua revelação — e o seu próprio documento assinado (payload versão 4).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE **NÃO** MUDA
--  ─────────────────────────────────────────────────────────────────────────────
--  1. Tudo o que já foi apurado vira a **RODADA 1**, com os MESMOS valores que
--     estavam em `raffles` (compromisso, selo, revelação, versão da chave, lista,
--     hash e versão do resultado). A auditoria de um sorteio antigo continua
--     abrindo exatamente como abria: ela lê a rodada e reconstrói o payload na
--     versão GRAVADA (1, 2 ou 3).
--  2. `raffle_winners` ganha `roundNumber`, com `DEFAULT 1`: as posições já
--     sorteadas pertencem à primeira rodada.
--  3. A POSIÇÃO continua sendo do sorteio, não da rodada — o segundo momento segue
--     a numeração do primeiro, e a entrega do prêmio (registrada por posição)
--     atravessa as rodadas sem mudar de regra.
--
--  As colunas de semente/lista em `raffles` ficam CONGELADAS como legado: o backfill
--  copia e o código novo não escreve mais nelas. A fonte de verdade passa a ser a
--  rodada — uma só.
--
--  `raffle_rounds` nasce com RLS: a policy é aplicada por `npm run db:rls`, que
--  descobre as tabelas de tenant por introspecção (FASE 8). O contrato de isolamento
--  (`npm run db:verify`) cobra RLS + FORCE + policy na tabela nova.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.raffle_rounds (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"         uuid        NOT NULL,
  "raffleId"         uuid        NOT NULL,
  "roundNumber"      integer     NOT NULL,

  "prizeTitle"       varchar(200),
  "prizeDescription" text,
  "sponsorId"        uuid,

  "seedCommitment"   char(64),
  "seedSealed"       text,
  "seedRevealed"     varchar(128),
  "seedKeyVersion"   integer     NOT NULL DEFAULT 0,

  "poolSnapshot"     jsonb,
  "poolHash"         char(64),

  "resultHash"       char(64),
  "resultVersion"    integer     NOT NULL DEFAULT 4,

  "winnersCount"     integer     NOT NULL,
  "alternatesCount"  integer     NOT NULL DEFAULT 0,
  "eligibleCount"    integer     NOT NULL DEFAULT 0,

  "drawnAt"          timestamptz(6),

  "createdById"      uuid        NOT NULL,
  "createdAt"        timestamptz(6) NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT raffle_rounds_pkey PRIMARY KEY (id),
  CONSTRAINT raffle_rounds_raffleId_fkey FOREIGN KEY ("raffleId")
    REFERENCES public.raffles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT raffle_rounds_tenantId_fkey FOREIGN KEY ("tenantId")
    REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT raffle_rounds_sponsorId_fkey FOREIGN KEY ("sponsorId")
    REFERENCES public.sponsors(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT raffle_rounds_createdById_fkey FOREIGN KEY ("createdById")
    REFERENCES public."user"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS raffle_rounds_raffleId_roundNumber_key
  ON public.raffle_rounds ("raffleId", "roundNumber");

CREATE INDEX IF NOT EXISTS raffle_rounds_tenantId_raffleId_drawnAt_idx
  ON public.raffle_rounds ("tenantId", "raffleId", "drawnAt");

CREATE INDEX IF NOT EXISTS raffle_rounds_sponsorId_idx
  ON public.raffle_rounds ("sponsorId");

-- ───────────────────────────────────────────────────────────────────────────────
--  A RODADA 1 DO HISTÓRICO
-- ───────────────────────────────────────────────────────────────────────────────
--  `ON CONFLICT DO NOTHING` porque a migração precisa poder ser reaplicada em um
--  banco que já a rodou (o `db:migrate:deploy` do projeto é idempotente por hábito,
--  e uma corrida aqui duplicaria o compromisso — que é justamente o que não pode).
INSERT INTO public.raffle_rounds (
  id, "tenantId", "raffleId", "roundNumber",
  "seedCommitment", "seedSealed", "seedRevealed", "seedKeyVersion",
  "poolSnapshot", "poolHash",
  "resultHash", "resultVersion",
  "winnersCount", "alternatesCount", "eligibleCount", "drawnAt",
  "createdById", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), r."tenantId", r.id, 1,
  r."seedCommitment", r."seedSealed", r."seedRevealed", r."seedKeyVersion",
  r."poolSnapshot", r."poolHash",
  r."resultHash", r."resultVersion",
  r."winnersCount", r."alternatesCount", r."eligibleCount", r."drawnAt",
  r."createdById", r."createdAt", now()
  FROM public.raffles r
 WHERE r."deletedAt" IS NULL
ON CONFLICT ("raffleId", "roundNumber") DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────────
--  AS POSIÇÕES JÁ SORTEADAS SÃO DA PRIMEIRA RODADA
-- ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.raffle_winners
  ADD COLUMN IF NOT EXISTS "roundNumber" integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS raffle_winners_raffleId_roundNumber_idx
  ON public.raffle_winners ("raffleId", "roundNumber");

COMMENT ON TABLE public.raffle_rounds IS
  'Rodada de apuração: um MOMENTO do sorteio, com o próprio compromisso/semente, lista publicada, resultado assinado e prêmio anunciado (FASE 30)';

COMMENT ON COLUMN public.raffle_rounds."resultVersion" IS
  'Versão do documento canônico assinado: 1–3 nas rodadas herdadas do histórico, 4 nas novas (com o número da rodada)';

COMMENT ON COLUMN public.raffle_winners."roundNumber" IS
  'Rodada que sorteou esta posição (1 para tudo o que veio antes da FASE 30)';

COMMENT ON COLUMN public.raffles."seedCommitment" IS
  'LEGADO CONGELADO (FASE 30): o compromisso passou a viver em raffle_rounds; estas colunas guardam o que já estava gravado e não recebem escrita nova';

COMMENT ON COLUMN public.raffles."poolSnapshot" IS
  'LEGADO CONGELADO (FASE 30): a lista publicada passou a viver em raffle_rounds';
