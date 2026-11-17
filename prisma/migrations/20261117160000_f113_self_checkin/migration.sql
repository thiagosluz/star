-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 113 — Autocredenciamento e Autocheck-in por QR Code com Antifraude
--
--  1. Tabela `self_checkin_points` sob RLS + FORCE + índices únicos parciais
--     garantindo no máximo um ponto ativo (não revogado) por portaria ou atividade.
--  2. Índices e GRANTs para `eventflow_app`.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "self_checkin_points" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "activityId" UUID,
  "token" VARCHAR(32) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "pinRequired" BOOLEAN NOT NULL DEFAULT false,
  "pinCode" VARCHAR(8),
  "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
  "totpSecret" VARCHAR(64),
  "createdById" UUID,
  "revokedAt" TIMESTAMPTZ(6),
  "revokedById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "self_checkin_points_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "self_checkin_points_token_key" ON "self_checkin_points"("token");
CREATE INDEX "self_checkin_points_tenantId_eventId_revokedAt_idx" ON "self_checkin_points"("tenantId", "eventId", "revokedAt");
CREATE INDEX "self_checkin_points_tenantId_activityId_revokedAt_idx" ON "self_checkin_points"("tenantId", "activityId", "revokedAt");

-- No máximo um QR Code vivo (não revogado) por portaria de evento e por atividade.
CREATE UNIQUE INDEX "self_checkin_points_active_event_key"
  ON "self_checkin_points"("tenantId", "eventId")
  WHERE "activityId" IS NULL AND "revokedAt" IS NULL;

CREATE UNIQUE INDEX "self_checkin_points_active_activity_key"
  ON "self_checkin_points"("tenantId", "activityId")
  WHERE "activityId" IS NOT NULL AND "revokedAt" IS NULL;

ALTER TABLE "self_checkin_points"
  ADD CONSTRAINT "self_checkin_points_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "self_checkin_points_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "self_checkin_points_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS + FORCE + GRANTs para a role de runtime ───────────────────────────────
ALTER TABLE "self_checkin_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "self_checkin_points" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public."self_checkin_points";
CREATE POLICY tenant_isolation ON public."self_checkin_points"
  FOR ALL
  TO eventflow_app
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.self_checkin_points TO eventflow_app;
