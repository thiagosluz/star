-- ─────────────────────────────────────────────────────────────────────────────
--  FASE 33 — correção: `call_for_proposals.deletedAt` ficou de fora
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O DEFEITO, E POR QUE NINGUÉM TINHA VISTO
--  ─────────────────────────────────────────────────────────────────────────────
--  A migração da fase foi escrita à mão (armadilha 53) e a coluna `deletedAt` não
--  entrou no CREATE TABLE — mas o `schema.prisma`, os serviços e as consultas todos
--  a usam (`where: { deletedAt: null }`). O resultado era uma tabela que EXISTIA,
--  respondia à verificação de contrato (`db:verify` confere `tenantId` e RLS, não a
--  lista de colunas) e falhava em TODA escrita com:
--
--      The column `call_for_proposals.deletedAt` does not exist in the current database.
--
--  Nenhum teste tocava a tabela antes desta rodada: o domínio e o contrato de schema
--  passavam, e o defeito estava exatamente entre os dois. Foi o primeiro teste de
--  integração da fase que o encontrou (`tests/integration/call-proposals.test.ts`).
--
--  A LIÇÃO: migração escrita à mão precisa ser conferida COLUNA A COLUNA contra o
--  modelo — o contrato de schema não é uma verificação de forma da tabela.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "call_for_proposals" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);

COMMENT ON COLUMN "call_for_proposals"."deletedAt" IS
  'Exclusao LOGICA da chamada (FASE 33). As propostas recebidas permanecem; a FK de submissions.callId e ON DELETE SET NULL.';

-- Despublicar e excluir andam juntos na exclusão lógica: a consulta pública filtra
-- `isPublished`, e a do painel filtra `deletedAt`. O índice cobre as duas leituras.
CREATE INDEX "call_for_proposals_tenantId_deletedAt_idx" ON "call_for_proposals"("tenantId", "deletedAt");
