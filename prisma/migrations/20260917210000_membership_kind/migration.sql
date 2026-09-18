-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 14 — `user_tenant_profiles.kind`: EQUIPE × PARTICIPANTE
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  PROBLEMA
--  ───────
--  A inscrição pública (FASE 10) cria vínculo ATIVO para quem se inscreve em evento
--  aberto. Está correto como concessão de acesso, mas o vínculo era o MESMO tipo de
--  vínculo do membro da equipe. Duas consequências:
--
--    • a lista "quem responde pela instituição", no painel de governança, passou a
--      exibir centenas de inscritos anônimos no meio da equipe;
--    • a quota `maxMembers` do plano (item C1) ficou impossível de aplicar: contar
--      vínculos equivalia a contar o público do evento, e um evento de 300 pessoas
--      estouraria o plano gratuito sozinho.
--
--  DECISÃO
--  ───────
--  A natureza do vínculo é dado, não dedução: coluna `kind` com `MEMBER` como
--  default (convite, provisionamento e seed continuam fazendo o certo sem mudar) e
--  `PARTICIPANT` gravado explicitamente pela inscrição pública.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O BACKFILL É UMA APROXIMAÇÃO — E O CRITÉRIO ESTÁ EM CÓDIGO
--  ─────────────────────────────────────────────────────────────────────────────
--  O dado histórico não guarda a ORIGEM do vínculo. O que ele guarda é o papel
--  concedido: a inscrição pública concede `PARTICIPANT` e só ele. Então:
--
--      vínculo cujo ÚNICO papel vigente é PARTICIPANT  ->  PARTICIPANT
--      qualquer outro caso                             ->  MEMBER (default)
--
--  O caso "sem papel nenhum" fica MEMBER de propósito: convite aceito cujo papel
--  ainda não foi concedido é equipe, não público — tratá-lo como participante o
--  esconderia da lista justamente de quem precisa terminar de configurá-lo.
--
--  A mesma regra existe como função pura e testada em
--  `src/domain/tenancy/membership-rules.ts` (`classifyMembershipKind`): o SQL abaixo
--  é a expressão dela para os dados já existentes, e não uma regra paralela.
--
--  Migração aplicada UMA vez pelo ledger do `prisma migrate deploy` (sem guardas de
--  idempotência, como na migração de particionamento).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Tipo e coluna ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembershipKind') THEN
    CREATE TYPE "MembershipKind" AS ENUM ('MEMBER', 'PARTICIPANT');
  END IF;
END
$$;

ALTER TABLE public.user_tenant_profiles
  ADD COLUMN IF NOT EXISTS kind "MembershipKind" NOT NULL DEFAULT 'MEMBER';

-- ── 2. Backfill: quem só tem o papel de participante é público, não equipe ─────
UPDATE public.user_tenant_profiles p
   SET kind = 'PARTICIPANT'
 WHERE p.kind = 'MEMBER'
   AND EXISTS (
     SELECT 1
       FROM public.role_assignments ra
      WHERE ra."tenantId" = p."tenantId"
        AND ra."userId" = p."userId"
        AND ra."revokedAt" IS NULL
        AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.role_assignments ra
      WHERE ra."tenantId" = p."tenantId"
        AND ra."userId" = p."userId"
        AND ra."revokedAt" IS NULL
        AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
        AND ra.role <> 'PARTICIPANT'
   );

-- ── 3. Índice de contagem e de separação nas listagens ────────────────────────
CREATE INDEX IF NOT EXISTS "user_tenant_profiles_tenantId_kind_status_idx"
  ON public.user_tenant_profiles ("tenantId", "kind", "status");

-- ── 4. A policy de RLS já cobre a tabela (descoberta por introspecção) ────────
--  Nada a fazer aqui: `tenant_isolation` é aplicada pelo loop de introspecção da
--  migração 20260917191000_rls_policies sobre toda tabela com a coluna `tenantId` —
--  inclusive esta, que ganhou apenas uma coluna nova. O `npm run db:verify` falharia
--  se a policy tivesse ficado para trás.
