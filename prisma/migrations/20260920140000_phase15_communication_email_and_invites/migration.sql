-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 15 — Comunicação: outbox de e-mail e convite de equipe
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE ESTA MIGRAÇÃO É ESCRITA À MÃO
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate dev` gera, junto com as tabelas novas, um bloco de "limpeza"
--  que DESTRUIRIA o que foi criado à mão em migrações anteriores: os índices
--  parciais/compostos que o schema.prisma não descreve (índice único parcial de
--  inscrição viva, índice de sorteio público, janela de exibição da página…) e
--  renomeações de constraint herdadas. O ledger do Prisma compara o schema com o
--  banco — e o banco tem mais do que o schema declara, por desenho.
--
--  Então o arquivo abaixo contém APENAS os objetos desta fase. É o mesmo caminho
--  já usado em `20260916214408_registration_live_unique` e
--  `20260917180000_role_assignment_live_unique`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- ─── Outbox de e-mail ─────────────────────────────────────────────────────────
-- `tenantId` é NULO nas mensagens de plataforma (verificação de e-mail e
-- redefinição de senha): elas existem antes de haver instituição no contexto.
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "to" VARCHAR(320) NOT NULL,
    "toUserId" UUID,
    "template" VARCHAR(60) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" VARCHAR(200),
    "driver" VARCHAR(20),
    "providerId" VARCHAR(160),
    "error" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(6),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- ─── Convite de equipe ────────────────────────────────────────────────────────
CREATE TABLE "tenant_invitations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "RoleKey" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "message" VARCHAR(400),
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMPTZ(6),
    "invitedById" UUID,
    "acceptedById" UUID,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

-- ─── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX "email_messages_tenantId_createdAt_idx" ON "email_messages"("tenantId", "createdAt");
CREATE INDEX "email_messages_tenantId_status_createdAt_idx" ON "email_messages"("tenantId", "status", "createdAt");
CREATE INDEX "email_messages_status_createdAt_idx" ON "email_messages"("status", "createdAt");
CREATE INDEX "email_messages_to_idx" ON "email_messages"("to");

-- Idempotência do fato: o mesmo acontecimento não gera duas mensagens, mesmo que
-- o gatilho rode duas vezes (retry do job, dupla submissão). No PostgreSQL um
-- índice único aceita VÁRIOS nulos, então as mensagens sem chave convivem.
CREATE UNIQUE INDEX "email_messages_dedupeKey_key" ON "email_messages"("dedupeKey");

CREATE INDEX "tenant_invitations_tenantId_status_createdAt_idx" ON "tenant_invitations"("tenantId", "status", "createdAt");
CREATE INDEX "tenant_invitations_tokenHash_idx" ON "tenant_invitations"("tokenHash");
CREATE INDEX "tenant_invitations_email_idx" ON "tenant_invitations"("email");

-- Um convite PENDENTE por endereço em cada instituição. Índice PARCIAL (e não
-- `@@unique` no schema) porque o que precisa ser único é o estado vivo: o mesmo
-- endereço pode ter convites antigos aceitos ou revogados, e reconvidar alguém
-- que saiu da equipe precisa continuar possível. Regerar um convite REVOGA o
-- anterior na mesma transação — é o que faz o índice nunca ser violado por acaso.
CREATE UNIQUE INDEX "tenant_invitations_live_email_key"
    ON "tenant_invitations"("tenantId", "email")
    WHERE "status" = 'PENDING';

-- ─── Chaves estrangeiras ──────────────────────────────────────────────────────
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_acceptedById_fkey"
    FOREIGN KEY ("acceptedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
