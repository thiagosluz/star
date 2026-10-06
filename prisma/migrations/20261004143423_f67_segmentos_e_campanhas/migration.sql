-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 67 — COMUNICAÇÃO SEGMENTADA POR FATOS (fatia 1 · fundação)
--
--  Cria duas tabelas de tenant:
--
--    • `communication_campaigns` — o ATO de enviar: quem disparou, quando, com que
--      DEFINIÇÃO de segmento (os fatos e os parâmetros, nunca a lista de ids), as
--      frases que o organizador leu, a contagem do momento do envio, o estado e o
--      erro. Quem recebeu está no outbox (`email_messages`), uma linha por
--      destinatário — esta tabela não duplica isso.
--
--    • `communication_unsubscribes` — uma linha por (instituição, pessoa) que
--      saiu, com o SHA-256 do token da página sem login, quando saiu, por qual
--      campanha/canal e o caminho de volta (`resubscribedAt`). O disparo pula quem
--      está fora; "quem já saiu alguma vez" continua tendo resposta porque a volta
--      NÃO apaga a linha.
--
--  O modelo em `schema.prisma` explica o desenho de cada uma.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  RLS + FORCE — e por que a POLICY não está neste arquivo
--  ─────────────────────────────────────────────────────────────────────────────
--  A policy `tenant_isolation` é criada por INTROSPECÇÃO em
--  `20260917191000_rls_policies/migration.sql`: toda tabela com a coluna `tenantId`
--  recebe ENABLE + FORCE + a policy. Isso é deliberado desde a FASE 8 — uma lista
--  escrita à mão é uma lista que alguém esquece de atualizar, e uma tabela com RLS
--  habilitada e SEM policy é fail-closed (a aplicação não lê nada).
--
--  O FORCE vai EXPLÍCITO aqui pelo mesmo motivo da FASE 65: `npm run db:verify` lê
--  o catálogo do banco, e `npm run db:rls` (que aplica a policy) é um passo separado
--  do `prisma migrate`. Assim a tabela nasce no estado correto mesmo entre os dois
--  comandos.
--
--  ⚠ O FORCE importa mais do que o ENABLE: sem ele o DONO da tabela
--  (`eventflow_admin`) ignora a policy — e é a role que o seed e as CLIs usam.
--  Com FORCE, nem o dono passa por cima do isolamento.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- CreateTable
CREATE TABLE "communication_campaigns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID,
    "createdById" UUID,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "explanation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "reachedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "communication_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_unsubscribes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "unsubscribedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" UUID,
    "channel" VARCHAR(16) NOT NULL DEFAULT 'EMAIL',
    "reason" VARCHAR(300),
    "resubscribedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "communication_unsubscribes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_campaigns_tenantId_createdAt_idx" ON "communication_campaigns"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "communication_campaigns_tenantId_eventId_status_idx" ON "communication_campaigns"("tenantId", "eventId", "status");

-- CreateIndex
CREATE INDEX "communication_campaigns_createdById_idx" ON "communication_campaigns"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "communication_unsubscribes_tokenHash_key" ON "communication_unsubscribes"("tokenHash");

-- CreateIndex
CREATE INDEX "communication_unsubscribes_tenantId_unsubscribedAt_idx" ON "communication_unsubscribes"("tenantId", "unsubscribedAt");

-- CreateIndex
CREATE INDEX "communication_unsubscribes_campaignId_idx" ON "communication_unsubscribes"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_unsubscribes_tenantId_userId_key" ON "communication_unsubscribes"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_unsubscribes" ADD CONSTRAINT "communication_unsubscribes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_unsubscribes" ADD CONSTRAINT "communication_unsubscribes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_unsubscribes" ADD CONSTRAINT "communication_unsubscribes_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "communication_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Isolamento (a policy vem do arquivo de RLS por introspecção — ver o cabeçalho).
ALTER TABLE "communication_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_campaigns" FORCE ROW LEVEL SECURITY;
ALTER TABLE "communication_unsubscribes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_unsubscribes" FORCE ROW LEVEL SECURITY;

-- Concessões da role de runtime. Os privilégios padrão do banco já concedem CRUD às
-- tabelas novas; declarar aqui deixa a intenção explícita e não depende de `ALTER
-- DEFAULT PRIVILEGES` de um volume antigo. TRUNCATE fica de fora de propósito — o
-- contrato (`assert-schema-contract.mjs`) reprova a role que puder truncar.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "communication_campaigns" TO eventflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "communication_unsubscribes" TO eventflow_app;
