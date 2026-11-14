-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 110 — Privacidade verificável, consentimento versionado e IP mascarado
--
--  1. Tabela de plataforma `cookie_consents` (sem RLS, revogada de `eventflow_app`).
--  2. Snapshot versionado do consentimento em `registrations` (`consentVersion`, `consentText`).
--  3. Evento `ACCOUNT_DELETED` em `IdentityAuditEvent`.
--  4. Mascaramento retroativo (/24 IPv4, /48 IPv6) de IPs em claro em `audit_logs`
--     e `identity_audit_logs`.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TYPE "IdentityAuditEvent" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETED';

ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "consentVersion" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "consentText" VARCHAR(800);

-- Inscrições antigas com consentAt preenchido passam a declarar honestamente a versão legada.
UPDATE "registrations"
SET
  "consentVersion" = 'legado-pre-f110',
  "consentText" = CASE
    WHEN "consentData" = true AND "consentImage" = true THEN '[Dados:ACEITO] Tratamento de dados pessoais para organização do evento | [Imagem:ACEITO] Uso de imagem (registro anterior à versão textual explícita)'
    WHEN "consentData" = true THEN '[Dados:ACEITO] Tratamento de dados pessoais para organização do evento | [Imagem:NAO_AUTORIZADO] (registro anterior à versão textual explícita)'
    ELSE 'Registro anterior à versão textual explícita'
  END
WHERE "consentAt" IS NOT NULL AND "consentVersion" IS NULL;

CREATE TABLE "cookie_consents" (
    "id" UUID NOT NULL,
    "consentToken" VARCHAR(64) NOT NULL,
    "userId" UUID,
    "policyVersion" VARCHAR(32) NOT NULL,
    "essentialAllowed" BOOLEAN NOT NULL DEFAULT true,
    "preferencesAllowed" BOOLEAN NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "ipAddressMasked" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cookie_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cookie_consents_consentToken_createdAt_idx" ON "cookie_consents"("consentToken", "createdAt");
CREATE INDEX "cookie_consents_userId_createdAt_idx" ON "cookie_consents"("userId", "createdAt");
CREATE INDEX "cookie_consents_createdAt_idx" ON "cookie_consents"("createdAt");

REVOKE ALL ON TABLE "cookie_consents" FROM "eventflow_app";
REVOKE ALL ON TABLE "cookie_consents" FROM PUBLIC;

-- Mascaramento retroativo de IPv4 (/24) e IPv6 (/48) já persistidos na auditoria.
UPDATE "audit_logs"
SET "ipAddress" = CASE
  WHEN "ipAddress" ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
    THEN regexp_replace("ipAddress", '^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0')
  WHEN "ipAddress" ~ '^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
    THEN regexp_replace("ipAddress", '^(::ffff:\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0')
  WHEN "ipAddress" LIKE '%:%' AND "ipAddress" !~ '::$'
    THEN split_part("ipAddress", ':', 1) || ':' || split_part("ipAddress", ':', 2) || ':' || split_part("ipAddress", ':', 3) || '::'
  ELSE "ipAddress"
END
WHERE "ipAddress" IS NOT NULL;

UPDATE "identity_audit_logs"
SET "ipAddress" = CASE
  WHEN "ipAddress" ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
    THEN regexp_replace("ipAddress", '^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0')
  WHEN "ipAddress" ~ '^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
    THEN regexp_replace("ipAddress", '^(::ffff:\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$', '\1.0')
  WHEN "ipAddress" LIKE '%:%' AND "ipAddress" !~ '::$'
    THEN split_part("ipAddress", ':', 1) || ':' || split_part("ipAddress", ':', 2) || ':' || split_part("ipAddress", ':', 3) || '::'
  ELSE "ipAddress"
END
WHERE "ipAddress" IS NOT NULL;
