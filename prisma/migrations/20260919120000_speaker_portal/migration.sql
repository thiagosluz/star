-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 25 — Portal do palestrante, vitrine pública e materiais
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  O que esta migração acrescenta:
--
--    E18  tabela `speaker_profiles`            → o palestrante passa a ser PESSOA
--    E18  `activity_speakers."speakerProfileId"` → o vínculo aponta para o perfil
--    E19  `activity_speakers` syllabus/requirements/bibliography/roleTitle
--    E20  tabela `speaker_materials`           → materiais com visibilidade própria
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE UMA TABELA NOVA, E NÃO COLUNAS A MAIS
--  ─────────────────────────────────────────────────────────────────────────────
--  Até a FASE 24, nome/bio/foto/instituição viviam em `activity_speakers`, o que
--  funcionava enquanto o palestrante existia em uma única atividade. A partir do
--  momento em que ele:
--    • tem portal próprio e edita a PRÓPRIA bio;
--    • recebe um certificado que SOMA as atividades que ministrou;
--    • pode ser convidado para a edição seguinte do evento,
--  duas linhas do mesmo convidado divergiriam — ele corrige a bio em uma e a outra
--  continua desatualizada. O perfil é da PESSOA; o vínculo guarda o que é do PAR
--  (papel nesta atividade, ordem na agenda, carga horária, contribuição de ementa).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  RLS DAS TABELAS NOVAS
--  ─────────────────────────────────────────────────────────────────────────────
--  `speaker_profiles` e `speaker_materials` têm `tenantId`, então nascem com
--  ENABLE + FORCE + policy `tenant_isolation`, no mesmo bloco da migração
--  20260917191000 (que criou as policies por introspecção). O `npm run db:verify`
--  confirma as duas.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  BACKFILL: NENHUMA LINHA EXISTENTE FICA ÓRFÃ
--  ─────────────────────────────────────────────────────────────────────────────
--  A coluna nasce NULA e o passo 4 cria um perfil para cada vínculo que já existia
--  — um por (instituição, usuário) para quem tem conta, um por (instituição, nome)
--  para convidado externo — e aponta os vínculos para ele. A coluna continua NULA
--  apenas em linha sem conta E sem nome, que não tinha identidade para migrar.
--
--  Migração aplicada UMA vez pelo ledger do `prisma migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Perfil do palestrante (E18) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.speaker_profiles (
  id                UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"        UUID           NOT NULL,
  name              VARCHAR(160)   NOT NULL,
  email             VARCHAR(255),
  institution       VARCHAR(200),
  company           VARCHAR(200),
  "roleTitle"       VARCHAR(120),
  bio               TEXT,
  "avatarUrl"       VARCHAR(1024),
  "socialLinks"     JSON           NOT NULL DEFAULT '{}',
  "userId"          UUID,
  "inviteTokenHash" CHAR(64),
  "inviteExpiresAt" TIMESTAMPTZ(6),
  "inviteSentAt"    TIMESTAMPTZ(6),
  "isConfirmed"     BOOLEAN        NOT NULL DEFAULT false,
  "isPublic"        BOOLEAN        NOT NULL DEFAULT true,
  "displayOrder"    INTEGER        NOT NULL DEFAULT 0,
  "createdById"     UUID,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt"       TIMESTAMPTZ(6),

  CONSTRAINT speaker_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT "speaker_profiles_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  -- A conta pode ser removida sem levar o perfil: a instituição continua sabendo
  -- quem era o palestrante e pode convidá-lo novamente na edição seguinte.
  CONSTRAINT "speaker_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."user"(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "speaker_profiles_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES public."user"(id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- Um e-mail por instituição. Vários NULL convivem (no PostgreSQL NULL é distinto),
-- o que permite cadastrar o convidado antes de saber o e-mail dele.
CREATE UNIQUE INDEX IF NOT EXISTS "speaker_profiles_tenantId_email_key"
  ON public.speaker_profiles ("tenantId", email);

CREATE INDEX IF NOT EXISTS "speaker_profiles_tenantId_userId_idx"
  ON public.speaker_profiles ("tenantId", "userId");

CREATE INDEX IF NOT EXISTS "speaker_profiles_tenantId_deletedAt_idx"
  ON public.speaker_profiles ("tenantId", "deletedAt");

CREATE INDEX IF NOT EXISTS "speaker_profiles_tenantId_displayOrder_idx"
  ON public.speaker_profiles ("tenantId", "displayOrder");

-- ── 2. Vínculo com a atividade: papel, ementa e ponteiro para o perfil (E18/E19) ─
ALTER TABLE public.activity_speakers
  ADD COLUMN IF NOT EXISTS "speakerProfileId" UUID,
  ADD COLUMN IF NOT EXISTS "roleTitle"        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS syllabus           TEXT,
  ADD COLUMN IF NOT EXISTS requirements       TEXT,
  ADD COLUMN IF NOT EXISTS bibliography       TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_speakers_speakerProfileId_fkey'
  ) THEN
    -- `SET NULL`, e não `CASCADE`: apagar o perfil do palestrante não pode apagar a
    -- atividade — a agenda do evento é da instituição, não do convidado.
    ALTER TABLE public.activity_speakers
      ADD CONSTRAINT "activity_speakers_speakerProfileId_fkey"
      FOREIGN KEY ("speakerProfileId") REFERENCES public.speaker_profiles(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "activity_speakers_tenantId_speakerProfileId_idx"
  ON public.activity_speakers ("tenantId", "speakerProfileId");

-- ── 3. Materiais do palestrante (E20) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.speaker_materials (
  id                 UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"         UUID           NOT NULL,
  "activityId"       UUID           NOT NULL,
  "speakerProfileId" UUID           NOT NULL,
  title              VARCHAR(200)   NOT NULL,
  description        VARCHAR(600),
  kind               VARCHAR(32)    NOT NULL,
  visibility         VARCHAR(24)    NOT NULL DEFAULT 'PRIVATE',
  "storageBucket"    VARCHAR(120),
  "storageKey"       VARCHAR(1024),
  "fileName"         VARCHAR(300),
  "mimeType"         VARCHAR(120),
  "sizeBytes"        INTEGER,
  checksum           CHAR(64),
  url                VARCHAR(1024),
  "displayOrder"     INTEGER        NOT NULL DEFAULT 0,
  "uploadedById"     UUID,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt"        TIMESTAMPTZ(6),

  CONSTRAINT speaker_materials_pkey PRIMARY KEY (id),
  CONSTRAINT "speaker_materials_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public.tenants(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "speaker_materials_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES public.activities(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "speaker_materials_speakerProfileId_fkey"
    FOREIGN KEY ("speakerProfileId") REFERENCES public.speaker_profiles(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "speaker_materials_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES public."user"(id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "speaker_materials_tenantId_activityId_visibility_idx"
  ON public.speaker_materials ("tenantId", "activityId", visibility);

CREATE INDEX IF NOT EXISTS "speaker_materials_tenantId_speakerProfileId_idx"
  ON public.speaker_materials ("tenantId", "speakerProfileId");

CREATE INDEX IF NOT EXISTS "speaker_materials_deletedAt_idx"
  ON public.speaker_materials ("deletedAt");

-- ── 4. Backfill: perfil para cada vínculo que já existia ──────────────────────

-- 4a. Quem TEM conta: um perfil por (instituição, usuário).
INSERT INTO public.speaker_profiles (
  id, "tenantId", name, email, "userId", "isConfirmed", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), v."tenantId", v.name, v.email, v."userId", true, now(), now()
  FROM (
    SELECT DISTINCT ON (s."tenantId", s."userId")
           s."tenantId", s."userId", u.name, u.email
      FROM public.activity_speakers s
      JOIN public."user" u ON u.id = s."userId"
     WHERE s."userId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.speaker_profiles p
          WHERE p."tenantId" = s."tenantId" AND p."userId" = s."userId"
       )
     ORDER BY s."tenantId", s."userId"
  ) AS v;

-- 4b. Convidado externo: um perfil por (instituição, nome).
INSERT INTO public.speaker_profiles (
  id, "tenantId", name, email, institution, bio, "isConfirmed", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), v."tenantId", v."guestName", v."guestEmail",
       v."guestInstitution", v."guestBio", false, now(), now()
  FROM (
    SELECT DISTINCT ON (s."tenantId", s."guestName")
           s."tenantId", s."guestName", s."guestEmail",
           s."guestInstitution", s."guestBio"
      FROM public.activity_speakers s
     WHERE s."userId" IS NULL
       AND s."guestName" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.speaker_profiles p
          WHERE p."tenantId" = s."tenantId"
            AND p."userId" IS NULL
            AND p.name = s."guestName"
       )
     ORDER BY s."tenantId", s."guestName"
  ) AS v;

-- 4c. Aponta cada vínculo para o perfil correspondente.
UPDATE public.activity_speakers s
   SET "speakerProfileId" = p.id
  FROM public.speaker_profiles p
 WHERE s."speakerProfileId" IS NULL
   AND p."tenantId" = s."tenantId"
   AND (
     (s."userId" IS NOT NULL AND p."userId" = s."userId")
     OR (s."userId" IS NULL AND p."userId" IS NULL AND p.name = s."guestName")
   );

-- ── 5. RLS: ENABLE + FORCE + policy de isolamento (tabelas novas) ─────────────
ALTER TABLE public.speaker_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speaker_profiles  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.speaker_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speaker_materials FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.speaker_profiles'::regclass
       AND polname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.speaker_profiles
      USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.speaker_materials'::regclass
       AND polname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.speaker_materials
      USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END
$$;

-- ── 6. GRANTs para a role de runtime ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaker_profiles  TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaker_materials TO eventflow_app;
