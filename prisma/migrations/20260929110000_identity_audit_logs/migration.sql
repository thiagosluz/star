-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 49 — trilha de IDENTIDADE (`identity_audit_logs`)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE ESTAVA FALTANDO
--  ─────────────────────────────────────────────────────────────────────────────
--  `audit_logs` tem `tenantId` e RLS: registra o que acontece DENTRO de uma
--  instituição. Trocar senha, ligar/desligar o segundo fator, trocar e-mail,
--  encerrar sessões e pedir redefinição de senha são fatos da CONTA — que existe
--  sem instituição (ADR-002). Até aqui o que restava era o efeito no banco
--  (`twoFactorEnabled`, `updatedAt`), sem autor, sem hora e sem origem: a pergunta
--  "de onde veio esta troca de senha?" não tinha resposta (dívida E67).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE A PROTEÇÃO AQUI É O PRIVILÉGIO, E NÃO A RLS
--  ─────────────────────────────────────────────────────────────────────────────
--  Não há `tenantId` por onde isolar — a linha pertence a UMA pessoa, não a uma
--  casa. Então RLS não teria o que comparar, e uma policy artificial só daria a
--  impressão de proteção. O que protege é o MESMO caminho de `two_factor` e
--  `job_runs`: a role de runtime NÃO TEM privilégio nesta tabela (o provisionamento
--  concede CRUD a toda tabela nova, e aqui isso é revogado), e quem escreve e lê é
--  a conexão de plataforma (`adminPrisma`, invariante nº 1). A verificação de
--  contrato passa a exigir a revogação por causa de `IDENTITY_ONLY_TABLES`.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  SEM CHAVE ESTRANGEIRA, DE PROPÓSITO
--  ─────────────────────────────────────────────────────────────────────────────
--  `userId` e `actorId` são UUIDs soltos: a trilha de segurança precisa sobreviver
--  à exclusão da conta. Com `ON DELETE CASCADE` o fato sumiria junto com quem ele
--  descreve; com `SET NULL`, a investigação perderia o alvo. O identificador fica.
--
--  Detalhe do desenho: o que entra em `details` já vem sanitizado pelo domínio
--  (`sanitizeIdentityDetails`) — senha, token, código de recuperação e segredo TOTP
--  são substituídos por `[removido]` ANTES de chegar aqui. Trilha não é lugar de
--  segredo.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "IdentityAuditEvent" AS ENUM (
  'PASSWORD_CHANGED',
  'PASSWORD_SET',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'BACKUP_CODES_REGENERATED',
  'BACKUP_CODE_USED',
  'TWO_FACTOR_CHALLENGE_FAILED',
  'EMAIL_CHANGE_REQUESTED',
  'EMAIL_VERIFIED',
  'SESSION_REVOKED',
  'OTHER_SESSIONS_REVOKED',
  'PROFILE_PHOTO_CHANGED',
  'PROFILE_PHOTO_REMOVED'
);

-- CreateTable
CREATE TABLE "identity_audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "actorId" UUID,
    "event" "IdentityAuditEvent" NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_audit_logs_userId_createdAt_idx" ON "identity_audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "identity_audit_logs_event_createdAt_idx" ON "identity_audit_logs"("event", "createdAt");

-- CreateIndex
CREATE INDEX "identity_audit_logs_createdAt_idx" ON "identity_audit_logs"("createdAt");

-- A role de runtime NÃO alcança a trilha de segurança da identidade.
REVOKE ALL ON TABLE "identity_audit_logs" FROM "eventflow_app";
REVOKE ALL ON TABLE "identity_audit_logs" FROM PUBLIC;
