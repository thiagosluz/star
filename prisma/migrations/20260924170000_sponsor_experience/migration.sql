-- ═══════════════════════════════════════════════════════════════════════════════
--  EXPERIÊNCIA DO PATROCINADOR — vínculo, QR e leitura com consentimento (FASE 42)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESCRITA À MÃO (armadilha 53)
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate diff` gera, junto do que é desta fase, RENAME/DROP de índices
--  parciais escritos à mão por fases anteriores (o `schema.prisma` não os declara).
--  Aqui ficou só o que a FASE 42 acrescenta.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE O ÍNDICE ÚNICO DE `sponsor_scans` É A REGRA, E NÃO UM DETALHE
--  ─────────────────────────────────────────────────────────────────────────────
--  `UNIQUE ("qrCodeId", "userId")` é a IDEMPOTÊNCIA do crédito: o QR do estande é
--  público, e sem ele reler o mesmo código creditaria XP de novo — farm. É também o
--  que garante UM contato por pessoa na lista do patrocinador, mesmo com duplo
--  toque no celular.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  OS DOIS ÚNICOS DE `sponsor_users` SÃO PARCIAIS POR NATUREZA
--  ─────────────────────────────────────────────────────────────────────────────
--  `UNIQUE ("sponsorId", "userId")` e `UNIQUE ("sponsorId", "invitedEmail")`
--  convivem porque a linha de convite tem `userId` NULO e a linha aceita tem
--  `invitedEmail` preenchido. O PostgreSQL trata NULLs como distintos em índice
--  único — então um único convite pendente por endereço e um único vínculo por
--  pessoa são garantidos sem que o convite pendente bloqueie o vínculo.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Novos valores de enum ──────────────────────────────────────────────────
-- A visita ao estande é uma FONTE de XP e um GATILHO de carta próprios: reaproveitar
-- `BONUS` apagaria a origem do crédito nos relatórios e na prestação de contas do
-- patrocínio.
ALTER TYPE "XpSourceKind" ADD VALUE IF NOT EXISTS 'SPONSOR_QR';
ALTER TYPE "CardTrigger"  ADD VALUE IF NOT EXISTS 'SPONSOR_QR';

CREATE TYPE "SponsorUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');

-- ── 2. Vínculo entre pessoa e patrocinador ────────────────────────────────────
CREATE TABLE "sponsor_users" (
    "id"              UUID               NOT NULL,
    "tenantId"        UUID               NOT NULL,
    "sponsorId"       UUID               NOT NULL,
    "userId"          UUID,
    "invitedEmail"    VARCHAR(255),
    "inviteTokenHash" VARCHAR(64),
    "inviteExpiresAt" TIMESTAMPTZ(6),
    "status"          "SponsorUserStatus" NOT NULL DEFAULT 'INVITED',
    "invitedById"     UUID,
    "acceptedAt"      TIMESTAMPTZ(6),
    "createdAt"       TIMESTAMPTZ(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6)     NOT NULL,
    "deletedAt"       TIMESTAMPTZ(6),

    CONSTRAINT "sponsor_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sponsor_users_sponsorId_userId_key"     ON "sponsor_users" ("sponsorId", "userId");
CREATE UNIQUE INDEX "sponsor_users_sponsorId_invitedEmail_key" ON "sponsor_users" ("sponsorId", "invitedEmail");
CREATE INDEX "sponsor_users_tenantId_userId_status_idx"      ON "sponsor_users" ("tenantId", "userId", "status");
CREATE INDEX "sponsor_users_inviteTokenHash_idx"             ON "sponsor_users" ("inviteTokenHash");

ALTER TABLE "sponsor_users"
  ADD CONSTRAINT "sponsor_users_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Excluir o patrocinador leva os vínculos dele junto (o patrocínio acabou).
ALTER TABLE "sponsor_users"
  ADD CONSTRAINT "sponsor_users_sponsorId_fkey"
  FOREIGN KEY ("sponsorId") REFERENCES "sponsors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A pessoa sai da plataforma e o vínculo fica sem titular: a organização revincula.
ALTER TABLE "sponsor_users"
  ADD CONSTRAINT "sponsor_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sponsor_users"
  ADD CONSTRAINT "sponsor_users_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. QR do patrocinador ─────────────────────────────────────────────────────
CREATE TABLE "sponsor_qr_codes" (
    "id"             UUID         NOT NULL,
    "tenantId"       UUID         NOT NULL,
    "sponsorId"      UUID         NOT NULL,
    "eventId"        UUID         NOT NULL,
    "code"           VARCHAR(16)  NOT NULL,
    "label"          VARCHAR(120) NOT NULL,
    "xpAmount"       INTEGER      NOT NULL DEFAULT 0,
    "cardTemplateId" UUID,
    "consentDays"    INTEGER      NOT NULL DEFAULT 90,
    "isActive"       BOOLEAN      NOT NULL DEFAULT true,
    "deletedAt"      TIMESTAMPTZ(6),
    "createdById"    UUID,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sponsor_qr_codes_pkey" PRIMARY KEY ("id")
);

-- O código identifica UM QR dentro da instituição (é ele que a página pública busca).
CREATE UNIQUE INDEX "sponsor_qr_codes_tenantId_code_key" ON "sponsor_qr_codes" ("tenantId", "code");
CREATE INDEX "sponsor_qr_codes_tenantId_sponsorId_isActive_idx" ON "sponsor_qr_codes" ("tenantId", "sponsorId", "isActive");
CREATE INDEX "sponsor_qr_codes_tenantId_eventId_idx"            ON "sponsor_qr_codes" ("tenantId", "eventId");

ALTER TABLE "sponsor_qr_codes"
  ADD CONSTRAINT "sponsor_qr_codes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sponsor_qr_codes"
  ADD CONSTRAINT "sponsor_qr_codes_sponsorId_fkey"
  FOREIGN KEY ("sponsorId") REFERENCES "sponsors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sponsor_qr_codes"
  ADD CONSTRAINT "sponsor_qr_codes_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A carta do QR é do catálogo; apagar a carta não apaga o QR (ele passa a só creditar XP).
ALTER TABLE "sponsor_qr_codes"
  ADD CONSTRAINT "sponsor_qr_codes_cardTemplateId_fkey"
  FOREIGN KEY ("cardTemplateId") REFERENCES "card_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sponsor_qr_codes"
  ADD CONSTRAINT "sponsor_qr_codes_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Leitura do QR (crédito + consentimento) ────────────────────────────────
CREATE TABLE "sponsor_scans" (
    "id"             UUID         NOT NULL,
    "tenantId"       UUID         NOT NULL,
    "qrCodeId"       UUID         NOT NULL,
    "sponsorId"      UUID         NOT NULL,
    "eventId"        UUID         NOT NULL,
    "userId"         UUID         NOT NULL,
    "consentedAt"    TIMESTAMPTZ(6),
    "expiresAt"      TIMESTAMPTZ(6),
    "revokedAt"      TIMESTAMPTZ(6),
    "consentText"    TEXT,
    "consentVersion" VARCHAR(8),
    "sharedName"     VARCHAR(160),
    "sharedEmail"    VARCHAR(255),
    "xpAwarded"      INTEGER      NOT NULL DEFAULT 0,
    "cardTemplateId" UUID,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsor_scans_pkey" PRIMARY KEY ("id")
);

-- UM crédito e UM contato por pessoa e por QR (é a trava do farm de XP).
CREATE UNIQUE INDEX "sponsor_scans_qrCodeId_userId_key" ON "sponsor_scans" ("qrCodeId", "userId");
CREATE INDEX "sponsor_scans_tenantId_sponsorId_consentedAt_idx" ON "sponsor_scans" ("tenantId", "sponsorId", "consentedAt");
CREATE INDEX "sponsor_scans_tenantId_userId_idx"                ON "sponsor_scans" ("tenantId", "userId");

ALTER TABLE "sponsor_scans"
  ADD CONSTRAINT "sponsor_scans_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apagar o QR apaga as leituras dele: o QR é a origem do dado, e a pessoa autorizou
-- o contato POR ELE (manter a leitura de um QR que não existe mais seria guardar
-- contato sem base).
ALTER TABLE "sponsor_scans"
  ADD CONSTRAINT "sponsor_scans_qrCodeId_fkey"
  FOREIGN KEY ("qrCodeId") REFERENCES "sponsor_qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sponsor_scans"
  ADD CONSTRAINT "sponsor_scans_sponsorId_fkey"
  FOREIGN KEY ("sponsorId") REFERENCES "sponsors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sponsor_scans"
  ADD CONSTRAINT "sponsor_scans_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apagar a PESSOA leva as leituras dela (dado pessoal não fica órfão).
ALTER TABLE "sponsor_scans"
  ADD CONSTRAINT "sponsor_scans_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. RLS: ENABLE + FORCE + policy nas três tabelas ──────────────────────────
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['sponsor_users', 'sponsor_qr_codes', 'sponsor_scans']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', tabela);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = format('public.%I', tabela)::regclass
         AND polname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I
           USING ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)
           WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)',
        tabela
      );
    END IF;
  END LOOP;
END
$$;

-- ── 6. GRANTs para a role de runtime ──────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_users    TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_qr_codes TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_scans    TO eventflow_app;
