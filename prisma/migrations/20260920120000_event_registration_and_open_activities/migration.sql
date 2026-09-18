-- ═══════════════════════════════════════════════════════════════════════════════
--  INSCRIÇÃO NO EVENTO E ATIVIDADES ABERTAS (revisão da FASE 3)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE MUDA, E POR QUÊ
--  ─────────────────────────────────────────────────────────────────────────────
--  A inscrição era sempre POR ATIVIDADE. Isso obriga a pessoa a se inscrever em
--  cada palestra da programação — e obriga a instituição a manter listas de
--  inscritos para atividades que não têm (nem precisam ter) controle de público.
--
--  Esta migração dá as duas peças que faltavam:
--
--    1. `activities."requiresRegistration"` — a atividade diz se tem inscrição
--       própria. `false` = ABERTA: quem se inscreve no evento entra nela
--       automaticamente, e vagas/lista de espera não se aplicam.
--
--    2. `registrations.origin` + a inscrição DO EVENTO (`"activityId" IS NULL`) —
--       o evento passa a ter inscrição própria, e a linha automática diz de onde
--       veio (`EVENT_AUTO`), para o cancelamento da inscrição do evento levar
--       junto só o que ele criou.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE **NÃO** MUDA
--  ─────────────────────────────────────────────────────────────────────────────
--  Nada de dado existente: o padrão de `requiresRegistration` é `true` (o
--  comportamento de hoje) e toda inscrição já gravada nasce `INDIVIDUAL`. Quem
--  já estava inscrito continua inscrito, e nenhuma atividade passa a recusar
--  inscrição por causa desta migração.
--
--  A tabela `registrations` já tem RLS + FORCE e a policy de isolamento (FASE 1) —
--  as colunas novas herdam as duas, porque policy de linha não depende de coluna.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Atividade aberta a todos os inscritos no evento ───────────────────────
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS "requiresRegistration" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.activities."requiresRegistration" IS
  'true = exige inscrição individual; false = aberta (recebe automaticamente quem se inscreveu no evento)';

-- ── 2. Origem da inscrição ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegistrationOrigin') THEN
    CREATE TYPE "RegistrationOrigin" AS ENUM ('INDIVIDUAL', 'EVENT_AUTO');
  END IF;
END
$$;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS "origin" "RegistrationOrigin" NOT NULL DEFAULT 'INDIVIDUAL';

COMMENT ON COLUMN public.registrations."origin" IS
  'INDIVIDUAL = escolhida pela pessoa; EVENT_AUTO = criada pela inscrição no evento (atividade aberta)';

-- ── 3. A inscrição DO EVENTO é única por pessoa ──────────────────────────────
--
--  O índice único parcial que já existe é `("activityId", "userId")` — e no
--  PostgreSQL NULLs são DISTINTOS entre si num índice único: sem o índice abaixo,
--  a mesma pessoa poderia se inscrever no evento N vezes, porque todas as linhas
--  teriam `"activityId" IS NULL`.
--
--  A condição de status é a mesma do índice de atividade: cancelamento é terminal,
--  e a linha cancelada não pode impedir uma nova inscrição.
CREATE UNIQUE INDEX IF NOT EXISTS "registrations_live_event_user_key"
  ON public.registrations ("eventId", "userId")
  WHERE "activityId" IS NULL
    AND status IN ('PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED');

-- ── 4. Índice da varredura de inscrições automáticas ─────────────────────────
--
--  Duas operações varrem por origem: cancelar a inscrição do evento (para levar
--  junto o que ela criou) e sincronizar atividade aberta publicada depois (para
--  inscrever quem já estava no evento).
CREATE INDEX IF NOT EXISTS "registrations_event_origin_idx"
  ON public.registrations ("tenantId", "eventId", "origin");
