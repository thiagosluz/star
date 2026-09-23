-- ═══════════════════════════════════════════════════════════════════════════════
--  QUADRO DE DEMANDAS INTERNAS DO EVENTO (FASE 38)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESCRITA À MÃO (armadilha 53)
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate dev --create-only` para nove tabelas novas produziria, além do
--  que esta fase acrescenta, os DROP INDEX de todos os índices parciais escritos à
--  mão por fases anteriores (que o `schema.prisma` não declara) e uma série de
--  RENAMEs de constraint alheias. Ficou só o que é desta fase: as nove tabelas,
--  seus índices (incluindo o índice PARCIAL que garante UM líder por equipe), as
--  chaves estrangeiras, a RLS + FORCE e as concessões.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE O ÍNDICE PARCIAL DO LÍDER É NO BANCO
--  ─────────────────────────────────────────────────────────────────────────────
--  "Um líder por equipe" é invariante, não validação de formulário: dois cliques
--  simultâneos em "definir como líder" (ou duas abas abertas) elegeriam dois sem
--  que nenhuma checagem em JavaScript percebesse. O índice único parcial
--  `WHERE "isLead"` faz o BANCO decidir, e a aplicação traduz a violação em
--  mensagem — a mesma escolha da reserva de vaga (invariante nº 5).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  SEM BACKFILL
--  ─────────────────────────────────────────────────────────────────────────────
--  A área é nova: não há dado anterior para migrar. O quadro e as colunas padrão
--  nascem na primeira visita à tela, e a criação é idempotente pelo
--  `@@unique([eventId])` de `demand_boards`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE "demand_boards" (
  "id"        UUID           NOT NULL,
  "tenantId"  UUID           NOT NULL,
  "eventId"   UUID           NOT NULL,
  "name"      VARCHAR(120)   NOT NULL DEFAULT 'Demandas do evento',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "demand_boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demand_columns" (
  "id"        UUID           NOT NULL,
  "tenantId"  UUID           NOT NULL,
  "boardId"   UUID           NOT NULL,
  "name"      VARCHAR(40)    NOT NULL,
  "position"  INTEGER        NOT NULL,
  "isDone"    BOOLEAN        NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "demand_columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demands" (
  "id"          UUID           NOT NULL,
  "tenantId"    UUID           NOT NULL,
  "boardId"     UUID           NOT NULL,
  "eventId"     UUID           NOT NULL,
  "columnId"    UUID           NOT NULL,
  "teamId"      UUID,
  "position"    INTEGER        NOT NULL DEFAULT 0,
  "title"       VARCHAR(160)   NOT NULL,
  "description" TEXT,
  "priority"    VARCHAR(10)    NOT NULL DEFAULT 'NORMAL',
  "startAt"     TIMESTAMPTZ(6),
  "dueAt"       TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  "createdById" UUID,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "demands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demand_assignees" (
  "id"        UUID           NOT NULL,
  "tenantId"  UUID           NOT NULL,
  "demandId"  UUID           NOT NULL,
  "userId"    UUID           NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demand_assignees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demand_comments" (
  "id"        UUID           NOT NULL,
  "tenantId"  UUID           NOT NULL,
  "demandId"  UUID           NOT NULL,
  "authorId"  UUID           NOT NULL,
  "body"      VARCHAR(2000)  NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "demand_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demand_mentions" (
  "id"         UUID           NOT NULL,
  "tenantId"   UUID           NOT NULL,
  "commentId"  UUID           NOT NULL,
  "userId"     UUID           NOT NULL,
  "notifiedAt" TIMESTAMPTZ(6),
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demand_mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "demand_events" (
  "id"        UUID           NOT NULL,
  "tenantId"  UUID           NOT NULL,
  "demandId"  UUID           NOT NULL,
  "actorId"   UUID,
  "kind"      VARCHAR(24)    NOT NULL,
  "fromValue" VARCHAR(200),
  "toValue"   VARCHAR(200),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demand_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_teams" (
  "id"          UUID           NOT NULL,
  "tenantId"    UUID           NOT NULL,
  "eventId"     UUID           NOT NULL,
  "name"        VARCHAR(80)    NOT NULL,
  "description" VARCHAR(300),
  "isActive"    BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "event_teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_team_members" (
  "id"        UUID           NOT NULL,
  "tenantId"  UUID           NOT NULL,
  "teamId"    UUID           NOT NULL,
  "userId"    UUID           NOT NULL,
  "isLead"    BOOLEAN        NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_team_members_pkey" PRIMARY KEY ("id")
);

-- ── 2. Índices ────────────────────────────────────────────────────────────────
-- Um quadro por evento: é também o que torna idempotente a criação das colunas
-- padrão na primeira visita (dois pedidos simultâneos, um quadro só).
CREATE UNIQUE INDEX "demand_boards_eventId_key" ON "demand_boards" ("eventId");
CREATE INDEX "demand_boards_tenantId_idx" ON "demand_boards" ("tenantId");

-- Duas colunas com o mesmo nome confundem quem arrasta.
CREATE UNIQUE INDEX "demand_columns_boardId_name_key" ON "demand_columns" ("boardId", "name");
CREATE INDEX "demand_columns_tenantId_boardId_position_idx"
  ON "demand_columns" ("tenantId", "boardId", "position");

-- A leitura do quadro: as demandas desta coluna, nesta ordem.
CREATE INDEX "demands_tenantId_boardId_columnId_position_idx"
  ON "demands" ("tenantId", "boardId", "columnId", "position");
-- A rotina de vencimento varre por prazo.
CREATE INDEX "demands_tenantId_dueAt_idx" ON "demands" ("tenantId", "dueAt");
-- O quadro de um evento e o resumo "o que ainda está aberto".
CREATE INDEX "demands_tenantId_eventId_completedAt_idx"
  ON "demands" ("tenantId", "eventId", "completedAt");
CREATE INDEX "demands_tenantId_teamId_idx" ON "demands" ("tenantId", "teamId");

CREATE UNIQUE INDEX "demand_assignees_demandId_userId_key"
  ON "demand_assignees" ("demandId", "userId");
CREATE INDEX "demand_assignees_tenantId_userId_idx" ON "demand_assignees" ("tenantId", "userId");

CREATE INDEX "demand_comments_tenantId_demandId_createdAt_idx"
  ON "demand_comments" ("tenantId", "demandId", "createdAt");

CREATE UNIQUE INDEX "demand_mentions_commentId_userId_key"
  ON "demand_mentions" ("commentId", "userId");
CREATE INDEX "demand_mentions_tenantId_userId_notifiedAt_idx"
  ON "demand_mentions" ("tenantId", "userId", "notifiedAt");

CREATE INDEX "demand_events_tenantId_demandId_createdAt_idx"
  ON "demand_events" ("tenantId", "demandId", "createdAt");

CREATE UNIQUE INDEX "event_teams_eventId_name_key" ON "event_teams" ("eventId", "name");
CREATE INDEX "event_teams_tenantId_eventId_idx" ON "event_teams" ("tenantId", "eventId");

CREATE UNIQUE INDEX "event_team_members_teamId_userId_key"
  ON "event_team_members" ("teamId", "userId");
CREATE INDEX "event_team_members_tenantId_userId_idx"
  ON "event_team_members" ("tenantId", "userId");

-- ── 3. UM líder por equipe (índice único PARCIAL — ver o cabeçalho) ───────────
CREATE UNIQUE INDEX "event_team_members_one_lead_per_team"
  ON "event_team_members" ("teamId") WHERE "isLead";

-- ── 4. Chaves estrangeiras ────────────────────────────────────────────────────
ALTER TABLE "demand_boards"
  ADD CONSTRAINT "demand_boards_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_boards"
  ADD CONSTRAINT "demand_boards_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "demand_columns"
  ADD CONSTRAINT "demand_columns_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_columns"
  ADD CONSTRAINT "demand_columns_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "demand_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "demands"
  ADD CONSTRAINT "demands_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demands"
  ADD CONSTRAINT "demands_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "demand_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demands"
  ADD CONSTRAINT "demands_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demands"
  ADD CONSTRAINT "demands_columnId_fkey"
  FOREIGN KEY ("columnId") REFERENCES "demand_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A equipe da demanda é opcional e NÃO derruba o cartão: excluir uma equipe
-- devolve as demandas dela para "sem equipe" (a guarda de "equipe em uso" vive no
-- serviço, e esta FK é a rede de segurança).
ALTER TABLE "demands"
  ADD CONSTRAINT "demands_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "event_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "demands"
  ADD CONSTRAINT "demands_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "demand_assignees"
  ADD CONSTRAINT "demand_assignees_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_assignees"
  ADD CONSTRAINT "demand_assignees_demandId_fkey"
  FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_assignees"
  ADD CONSTRAINT "demand_assignees_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "demand_comments"
  ADD CONSTRAINT "demand_comments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_comments"
  ADD CONSTRAINT "demand_comments_demandId_fkey"
  FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_comments"
  ADD CONSTRAINT "demand_comments_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "demand_mentions"
  ADD CONSTRAINT "demand_mentions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_mentions"
  ADD CONSTRAINT "demand_mentions_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "demand_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_mentions"
  ADD CONSTRAINT "demand_mentions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "demand_events"
  ADD CONSTRAINT "demand_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_events"
  ADD CONSTRAINT "demand_events_demandId_fkey"
  FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "demand_events"
  ADD CONSTRAINT "demand_events_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "event_teams"
  ADD CONSTRAINT "event_teams_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_teams"
  ADD CONSTRAINT "event_teams_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_team_members"
  ADD CONSTRAINT "event_team_members_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_team_members"
  ADD CONSTRAINT "event_team_members_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "event_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_team_members"
  ADD CONSTRAINT "event_team_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. RLS: ENABLE + FORCE + policy em cada tabela nova ───────────────────────
ALTER TABLE public.demand_boards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_boards       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.demand_columns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_columns      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.demands             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demands             FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.demand_assignees    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_assignees    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.demand_comments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_comments     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.demand_mentions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_mentions     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.demand_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_events       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.event_teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_teams         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.event_team_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_team_members  FORCE  ROW LEVEL SECURITY;

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'demand_boards', 'demand_columns', 'demands', 'demand_assignees',
    'demand_comments', 'demand_mentions', 'demand_events',
    'event_teams', 'event_team_members'
  ]
  LOOP
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_boards      TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_columns     TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demands            TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_assignees   TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_comments    TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_mentions    TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_events      TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_teams        TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_team_members TO eventflow_app;
