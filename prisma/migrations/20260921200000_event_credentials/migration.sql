-- ═══════════════════════════════════════════════════════════════════════════════
--  CRACHÁ DO PARTICIPANTE NO EVENTO (FASE 31)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE MUDA, E POR QUÊ
--  ─────────────────────────────────────────────────────────────────────────────
--  O crachá morava na INSCRIÇÃO (`registrations."badgeToken"`), e a inscrição é por
--  (pessoa × evento) E por (pessoa × atividade). Quem se inscrevia no evento e em
--  dois minicursos tinha TRÊS crachás — e a portaria não sabia qual ler.
--
--  Aqui o crachá passa a ser da PESSOA no EVENTO: um código opaco por par
--  (evento, pessoa). O monitor lê o código e escolhe o CONTEXTO (portaria do evento
--  ou a atividade que está acontecendo); o fato de presença continua por
--  (pessoa × atividade), em `attendances`.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE **NÃO** MUDA
--  ─────────────────────────────────────────────────────────────────────────────
--  1. `registrations."badgeToken"` fica como LEGADO CONGELADO: os crachás já
--     impressos continuam valendo, o código novo não escreve mais nesta coluna, e o
--     backfill abaixo traz cada token existente para a tabela nova (a preferência é
--     pela inscrição NO EVENTO, que é a que representa a pessoa).
--  2. `attendances` não muda: a sessão de presença já tem entrada, saída, minutos,
--     `registrationId` OPCIONAL (presença de quem não tinha inscrição é um fato real)
--     e `source` já distingue QR de registro manual.
--  3. Nenhum enum existente muda — `CredentialStatus` é novo e só desta tabela.
--
--  `event_credentials` nasce com RLS: a policy é aplicada por `npm run db:rls`, que
--  descobre as tabelas de tenant por introspecção (FASE 8). O contrato de isolamento
--  (`npm run db:verify`) cobra RLS + FORCE + policy na tabela nova.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CredentialStatus') THEN
    CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.event_credentials (
  id             uuid             NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"     uuid             NOT NULL,
  "eventId"      uuid             NOT NULL,
  "userId"       uuid             NOT NULL,

  code           varchar(32)      NOT NULL,
  status         "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',

  "issuedById"   uuid,
  "issuedAt"     timestamptz(6)   NOT NULL DEFAULT now(),

  "printedAt"    timestamptz(6),
  "printedById"  uuid,

  "revokedAt"    timestamptz(6),
  "revokedById"  uuid,
  "revokeReason" varchar(300),

  notes          varchar(300),

  "createdAt"    timestamptz(6)   NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz(6)   NOT NULL DEFAULT now(),

  CONSTRAINT event_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT event_credentials_tenantId_fkey FOREIGN KEY ("tenantId")
    REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT event_credentials_eventId_fkey FOREIGN KEY ("eventId")
    REFERENCES public.events(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT event_credentials_userId_fkey FOREIGN KEY ("userId")
    REFERENCES public."user"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT event_credentials_issuedById_fkey FOREIGN KEY ("issuedById")
    REFERENCES public."user"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT event_credentials_printedById_fkey FOREIGN KEY ("printedById")
    REFERENCES public."user"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT event_credentials_revokedById_fkey FOREIGN KEY ("revokedById")
    REFERENCES public."user"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- O código é único GLOBAL: uma leitura de crachá não pode depender de contexto para
-- saber de quem é. A RLS limita a busca à instituição do staff que está lendo.
CREATE UNIQUE INDEX IF NOT EXISTS event_credentials_code_key
  ON public.event_credentials (code);

-- UM crachá por pessoa por evento — é a decisão da fase, no banco.
CREATE UNIQUE INDEX IF NOT EXISTS event_credentials_eventId_userId_key
  ON public.event_credentials ("eventId", "userId");

CREATE INDEX IF NOT EXISTS event_credentials_tenantId_eventId_status_idx
  ON public.event_credentials ("tenantId", "eventId", status);

CREATE INDEX IF NOT EXISTS event_credentials_tenantId_userId_idx
  ON public.event_credentials ("tenantId", "userId");

-- ───────────────────────────────────────────────────────────────────────────────
--  O CRACHÁ DO HISTÓRICO
-- ───────────────────────────────────────────────────────────────────────────────
--  Cada token já impresso vira um crachá na tabela nova, com a data da inscrição
--  como data de emissão e SEM autor (`issuedById` nulo = "emitido antes de existir
--  controle de emissão"). A inscrição no EVENTO tem preferência sobre a de atividade:
--  é ela que representa a pessoa no evento, e o índice único (eventId, userId) faria
--  as demais serem descartadas de qualquer forma — a ordem só decide QUAL fica.
INSERT INTO public.event_credentials (
  id, "tenantId", "eventId", "userId", code, status, "issuedById", "issuedAt"
)
SELECT
  gen_random_uuid(), legacy."tenantId", legacy."eventId", legacy."userId",
  legacy."badgeToken", 'ACTIVE', NULL, legacy."createdAt"
  FROM (
    SELECT r."tenantId", r."eventId", r."userId", r."badgeToken", r."createdAt"
      FROM public.registrations r
     WHERE r."badgeToken" IS NOT NULL
       AND r."deletedAt" IS NULL
     ORDER BY (r."activityId" IS NOT NULL), r."createdAt"
  ) AS legacy
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.event_credentials IS
  'Crachá do participante no evento: um código opaco por par (evento, pessoa), com emissão, impressão e revogação (FASE 31)';

COMMENT ON COLUMN public.event_credentials.code IS
  'Código do crachá (CR-XXXX-XXXX) — é o conteúdo do QR Code; único global, sem dado pessoal';

COMMENT ON COLUMN public.event_credentials."issuedById" IS
  'Quem emitiu. NULO = emitido no backfill da FASE 31, antes de existir emissão pela tela';

COMMENT ON COLUMN public.registrations."badgeToken" IS
  'LEGADO CONGELADO (FASE 31): o crachá passou a viver em event_credentials; esta coluna guarda o que já foi impresso e não recebe escrita nova';
