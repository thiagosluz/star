-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 32 — Central do participante e inteligência da instituição
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE ESTA MIGRAÇÃO FOI ESCRITA À MÃO
--  ─────────────────────────────────────────────────────────────────────────────
--  O `prisma migrate dev --create-only` gerou, junto com o que esta fase precisa,
--  uma faxina que NÃO pode ser aplicada (armadilha 53): derrubava quatro índices
--  criados à mão pela FASE 17/22/23 — `event_pages_tenantId_eventId_unpublishAt_idx`,
--  `raffle_winners_raffleId_kind_idx`, `raffles_eventId_isPublic_status_idx` e
--  `registrations_event_origin_idx` — e removia defaults (`uuid_generate_v7()`) de
--  sete tabelas alheias, porque o `schema.prisma` não declara nem os índices parciais
--  nem os defaults que o banco usa. O Prisma compara o schema com o banco, vê o que
--  não conhece e propõe remover.
--
--  O que ficou aqui é SÓ o que a fase pede:
--    1. a ação `READ` na trilha (a ficha do participante é acesso a dado pessoal);
--    2. a tabela dos recados (`participant_messages`), com as chaves e os índices;
--    3. dois índices que faltavam para a agregação por PESSOA (a ficha atravessa
--       todos os eventos da instituição).
--
--  RLS: a policy desta tabela é criada pelo `npm run db:rls`, que descobre as tabelas
--  com `tenantId` por introspecção (armadilha 2) — e `npm run db:verify` reprova se
--  ela faltar.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. A trilha passa a saber registrar LEITURA ────────────────────────────────
--  Até aqui a auditoria só conhecia escrita: abrir a ficha de alguém ficava
--  invisível. `ADD VALUE` não pode ser usado na mesma transação em que é criado, e
--  esta migração só o adiciona.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'READ';

-- ── 2. Os recados da instituição para o participante ───────────────────────────
CREATE TABLE "participant_messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventId" UUID,
    "subject" VARCHAR(140) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "dedupeKey" VARCHAR(200) NOT NULL,
    "batchId" UUID,
    "sentById" UUID,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_messages_pkey" PRIMARY KEY ("id")
);

-- A chave que liga a mensagem ao e-mail do outbox: o MESMO texto gravado em
-- `email_messages."dedupeKey"` (FASE 15), que já é único. É por ele que o reenvio do
-- job é idempotente e por ele que a ficha encontra a entrega.
CREATE UNIQUE INDEX "participant_messages_dedupeKey_key" ON "participant_messages"("dedupeKey");

-- A CAIXA DE ENTRADA do participante: as mensagens dele, da mais nova para a antiga.
CREATE INDEX "participant_messages_tenantId_userId_sentAt_idx" ON "participant_messages"("tenantId", "userId", "sentAt");

-- O HISTÓRICO da instituição: o que ela mandou, em ordem.
CREATE INDEX "participant_messages_tenantId_sentAt_idx" ON "participant_messages"("tenantId", "sentAt");

-- O lote do envio em massa (um lote, N mensagens).
CREATE INDEX "participant_messages_tenantId_batchId_idx" ON "participant_messages"("tenantId", "batchId");

ALTER TABLE "participant_messages" ADD CONSTRAINT "participant_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "participant_messages" ADD CONSTRAINT "participant_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- `SET NULL`: excluir o evento não apaga o recado que a pessoa recebeu (o histórico
-- da comunicação é dela, e a exclusão do evento é decisão da instituição).
ALTER TABLE "participant_messages" ADD CONSTRAINT "participant_messages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "participant_messages" ADD CONSTRAINT "participant_messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "participant_messages" IS
  'Recado da instituição para um participante (FASE 32): caixa de entrada dele + e-mail pelo outbox.';
COMMENT ON COLUMN "participant_messages"."dedupeKey" IS
  'Mesmo valor de email_messages."dedupeKey" (FASE 15): liga a mensagem ao e-mail e torna o reenvio idempotente.';
COMMENT ON COLUMN "participant_messages"."readAt" IS
  'Quando o participante abriu o recado — enviado e LIDO são fatos diferentes.';

-- ── 3. Índices que faltavam para a agregação por PESSOA ────────────────────────
--  A ficha 360 responde "as presenças desta pessoa em todos os eventos" e "o que ela
--  recebeu". Sem estes dois índices, as duas consultas varrem a tabela inteira.
CREATE INDEX "attendances_tenantId_userId_checkedInAt_idx" ON "attendances"("tenantId", "userId", "checkedInAt");
CREATE INDEX "email_messages_tenantId_toUserId_createdAt_idx" ON "email_messages"("tenantId", "toUserId", "createdAt");
