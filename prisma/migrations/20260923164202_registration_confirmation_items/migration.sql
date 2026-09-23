-- ═══════════════════════════════════════════════════════════════════════════════
--  Exigências de confirmação POR INSCRIÇÃO (FASE 37 — quita a dívida E48)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESTA MIGRAÇÃO FOI ESCRITA À MÃO, E O RASCUNHO DO PRISMA FOI DESCARTADO
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate dev --create-only` gerou 133 linhas para uma tabela nova, das quais
--  130 eram ruído conhecido (armadilha 53): os cinco DROP INDEX de índices ESCRITOS À
--  MÃO por fases anteriores, sete ALTER COLUMN ... DROP DEFAULT, e vinte e cinco RENAMEs
--  de constraint/índice de tabelas que nada têm a ver com esta fase. Aplicar aquilo
--  derrubaria índices parciais que o `schema.prisma` não declara — inclusive o
--  `registrations_event_origin_idx` e o da janela de exibição da página. Ficou só o que
--  esta fase acrescenta: a tabela, os índices, as chaves estrangeiras, a RLS e o
--  BACKFILL do que já estava gravado.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE UMA TABELA, E NÃO UM JSON NA INSCRIÇÃO
--  ─────────────────────────────────────────────────────────────────────────────
--  O veredito de cada item precisa ser CONSULTÁVEL ("quem ainda não trouxe o quê") e
--  guardar autor e hora — e isso é linha, não documento. O JSON `confirmationRequirements`
--  da atividade continua sendo o MODELO; o que a pessoa foi cobrada no dia da inscrição
--  é o SNAPSHOT daqui, e ele não muda quando a atividade é editada depois.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. A tabela ───────────────────────────────────────────────────────────────
CREATE TABLE "registration_confirmation_items" (
  "id"             UUID          NOT NULL,
  "tenantId"       UUID          NOT NULL,
  "registrationId" UUID          NOT NULL,
  "position"       INTEGER       NOT NULL,
  "kind"           VARCHAR(20)   NOT NULL,
  "label"          VARCHAR(140)  NOT NULL,
  "note"           VARCHAR(200),
  "required"       BOOLEAN       NOT NULL DEFAULT true,
  "status"         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  "resolvedAt"     TIMESTAMPTZ(6),
  "resolvedById"   UUID,
  "resolutionNote" VARCHAR(300),
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "registration_confirmation_items_pkey" PRIMARY KEY ("id")
);

-- ── 2. Índices ────────────────────────────────────────────────────────────────
-- Uma linha por posição em cada inscrição: repetir o snapshot é erro, não duplicata.
CREATE UNIQUE INDEX "registration_confirmation_items_registrationId_position_key"
  ON "registration_confirmation_items" ("registrationId", "position");

-- A fila da equipe lê os itens das inscrições que ela está mostrando.
CREATE INDEX "registration_confirmation_items_tenantId_registrationId_status_idx"
  ON "registration_confirmation_items" ("tenantId", "registrationId", "status");

-- ── 3. Chaves estrangeiras ────────────────────────────────────────────────────
ALTER TABLE "registration_confirmation_items"
  ADD CONSTRAINT "registration_confirmation_items_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registration_confirmation_items"
  ADD CONSTRAINT "registration_confirmation_items_registrationId_fkey"
  FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registration_confirmation_items"
  ADD CONSTRAINT "registration_confirmation_items_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. RLS: ENABLE + FORCE + policy (tabela nova de instituição) ──────────────
ALTER TABLE public.registration_confirmation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_confirmation_items FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.registration_confirmation_items'::regclass
       AND polname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.registration_confirmation_items
      USING ("tenantId" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END
$$;

-- ── 5. GRANTs para a role de runtime ──────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registration_confirmation_items TO eventflow_app;

-- ── 6. BACKFILL: as inscrições que já estavam RETIDAS ganham o checklist ──────
--
--  As linhas nascem no ato da inscrição (`snapshotRequirements`, no serviço) — mas as
--  que já existiam quando esta fase chegou não passaram por lá, e sem este passo a fila
--  da equipe abriria SEM checklist justamente nas vagas mais antigas (armadilha 65: a
--  entidade nova precisa ser gravada também pelo caminho mais antigo).
--
--  `jsonb_array_elements` preserva a ORDEM do modelo e `row_number() - 1` grava a
--  posição. Exigência sem rótulo é descartada, como faz `parseConfirmationRequirements`.
--  O `INSERT` é idempotente pelo índice único: rodar de novo não duplica.
INSERT INTO "registration_confirmation_items" (
  "id", "tenantId", "registrationId", "position", "kind", "label", "note", "required", "status",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  r."tenantId",
  r."id",
  (item.ordinality - 1)::int,
  COALESCE(NULLIF(item.value ->> 'kind', ''), 'OTHER'),
  LEFT(BTRIM(item.value ->> 'label'), 140),
  NULLIF(LEFT(BTRIM(COALESCE(item.value ->> 'note', '')), 200), ''),
  COALESCE((item.value ->> 'required')::boolean, true),
  'PENDING',
  now(),
  now()
FROM "registrations" r
JOIN "activities" a ON a."id" = r."activityId"
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(a."confirmationRequirements") = 'array'
       THEN a."confirmationRequirements"
       ELSE '[]'::jsonb END
) WITH ORDINALITY AS item(value, ordinality)
WHERE r."status" = 'PENDING'
  AND r."deletedAt" IS NULL
  AND a."confirmationPolicy" = 'REQUIRED'
  AND jsonb_typeof(a."confirmationRequirements") = 'array'
  AND BTRIM(COALESCE(item.value ->> 'label', '')) <> ''
  AND (item.ordinality - 1) < 10
ON CONFLICT ("registrationId", "position") DO NOTHING;
