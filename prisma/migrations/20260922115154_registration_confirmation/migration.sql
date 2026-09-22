-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 34 — Confirmação de vaga com prazo
--
--  Migração escrita À MÃO (armadilha 53): o `prisma migrate dev --create-only`
--  gerou, além destas linhas, ruído que NÃO entra:
--
--    • DROP INDEX de cinco índices criados à mão em migrações anteriores
--      (`call_for_proposals_tenantId_deletedAt_idx`,
--       `event_pages_tenantId_eventId_unpublishAt_idx`,
--       `raffle_winners_raffleId_kind_idx`, `raffles_eventId_isPublic_status_idx`,
--       `registrations_event_origin_idx`) — o Prisma não os conhece porque o schema
--       não expressa índice parcial, e apagá-los tiraria a proteção que a fase que os
--       criou quis;
--    • DROP DEFAULT de colunas `id`/`updatedAt`/`snapshot` que ganharam default no
--      banco por SQL escrito à mão;
--    • renames de constraints/índices de outras fases (drift antigo, sem relação com
--      esta entrega).
--
--  O que fica é o que esta fase acrescenta: o enum da política, as colunas da
--  atividade, as colunas da inscrição, o índice da varredura e a FK de quem confirmou.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ConfirmationPolicy" AS ENUM ('AUTO', 'REQUIRED');

-- AlterTable: a escolha do organizador no cadastro da atividade.
-- `AUTO` é o default porque preserva o comportamento de tudo o que já existe.
ALTER TABLE "activities"
  ADD COLUMN "confirmationPolicy" "ConfirmationPolicy" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "confirmationWindowDays" INTEGER,
  ADD COLUMN "confirmationRequirements" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "confirmationPlace" VARCHAR(300),
  ADD COLUMN "confirmationInstructions" TEXT;

-- AlterTable: o prazo e a confirmação de UMA inscrição.
-- `confirmationReminderAt` é a chave de idempotência do lembrete (a varredura roda de
-- hora em hora); `confirmedById` guarda QUEM confirmou, porque quem confirma é a
-- equipe.
ALTER TABLE "registrations"
  ADD COLUMN "confirmationDueAt" TIMESTAMPTZ(6),
  ADD COLUMN "confirmationReminderAt" TIMESTAMPTZ(6),
  ADD COLUMN "confirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN "confirmedById" UUID;

-- CreateIndex: a varredura pergunta "as pendentes desta instituição já venceram?".
CREATE INDEX "registrations_tenantId_status_confirmationDueAt_idx"
  ON "registrations"("tenantId", "status", "confirmationDueAt");

-- AddForeignKey
ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
