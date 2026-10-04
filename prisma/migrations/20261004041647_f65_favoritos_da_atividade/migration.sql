-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 65 — O DIA DO EVENTO NA MÃO DO PARTICIPANTE (fatia 1 · fundação)
--
--  Cria `activity_favorites`: UMA linha por par (PESSOA × ATIVIDADE). É a agenda
--  pessoal que a pessoa monta antes (ou sem) a inscrição — ver o comentário do
--  modelo em schema.prisma para o desenho e para a decisão do índice único TOTAL.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESTA TABELA NÃO ENCOSTA NO MOTOR DE INSCRIÇÃO
--  ─────────────────────────────────────────────────────────────────────────────
--  Não há FK para `registrations`, não há contador de vaga, e nenhum `UPDATE` em
--  `activities` sai daqui. Favoritar não reserva lugar, não consome quota, não
--  entra na loteria nem na lista de espera — quem garante lugar é a inscrição.
--  O teste de integração `tests/integration/f65-favoritos.test.ts` prende isso
--  com a atividade LOTADA: a marca funciona e `confirmedCount` não se move.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  RLS + FORCE — e por que a policy NÃO está neste arquivo
--  ─────────────────────────────────────────────────────────────────────────────
--  A policy `tenant_isolation` é criada por INTROSPECÇÃO em
--  `20260917191000_rls_policies/migration.sql`: toda tabela com a coluna `tenantId`
--  recebe ENABLE + FORCE + a policy. Isso é deliberado desde a FASE 8 — uma lista
--  de tabelas escrita à mão é uma lista que alguém esquece de atualizar, e uma
--  tabela com RLS habilitada e SEM policy é fail-closed (a aplicação não lê nada).
--
--  Ainda assim o FORCE vai EXPLÍCITO aqui: `npm run db:verify` lê o catálogo do
--  banco, e o `npm run db:rls` (que aplica a policy) é um passo separado do
--  `prisma migrate`. Assim a tabela nasce no estado correto mesmo entre os dois
--  comandos, e o contrato não depende da ordem de execução.
--
--  ⚠ O FORCE importa mais do que o ENABLE: sem ele o DONO da tabela
--  (`eventflow_admin`) ignora a policy — e é justamente a role que o seed e as CLIs
--  usam. Com FORCE, nem o dono passa por cima do isolamento.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "activity_favorites" (
  -- Sem DEFAULT: o id é UUID v7, gerado pelo Prisma na aplicação (a mesma escolha
  -- de todas as outras tabelas do projeto — `gen_random_uuid()` produziria v4, e a
  -- ordenação temporal do v7 é o que faz o índice do id ficar denso).
  "id"         UUID           NOT NULL,
  "tenantId"   UUID           NOT NULL,
  "activityId" UUID           NOT NULL,
  "userId"     UUID           NOT NULL,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "activity_favorites_pkey" PRIMARY KEY ("id")
);

-- O índice único é TOTAL (e não parcial como o de `registrations`): desfavoritar
-- APAGA a linha, então não existe estado terminal a preservar. É ele que torna
-- favoritar duas vezes idempotente no BANCO — `INSERT ... ON CONFLICT DO NOTHING`
-- (o mesmo par vindo de dois toques simultâneos não duplica).
CREATE UNIQUE INDEX "activity_favorites_activityId_userId_key"
  ON "activity_favorites" ("activityId", "userId");

-- "Os favoritos DESTA pessoa nesta instituição" — a leitura da minha grade entra
-- por aqui e junta a atividade para descobrir o evento. A ordem das colunas não é
-- decorativa: `userId` primeiro atende a FK de `user` (o CASCADE da exclusão de
-- conta não varre a tabela) e `tenantId` fecha o escopo da RLS.
CREATE INDEX "activity_favorites_userId_tenantId_idx"
  ON "activity_favorites" ("userId", "tenantId");

ALTER TABLE "activity_favorites"
  ADD CONSTRAINT "activity_favorites_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Excluir a ATIVIDADE leva os favoritos dela junto: uma marca sobre algo que não
-- existe mais não é agenda, é lixo que a tela teria de filtrar.
ALTER TABLE "activity_favorites"
  ADD CONSTRAINT "activity_favorites_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_favorites"
  ADD CONSTRAINT "activity_favorites_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolamento (a policy vem do arquivo de RLS por introspecção — ver o cabeçalho).
ALTER TABLE "activity_favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_favorites" FORCE ROW LEVEL SECURITY;

-- Concessões da role de runtime. Os privilégios padrão do banco já concedem CRUD às
-- tabelas novas; declarar aqui deixa a intenção explícita e não depende de `ALTER
-- DEFAULT PRIVILEGES` de um volume antigo. TRUNCATE fica de fora de propósito — o
-- contrato (`assert-schema-contract.mjs`) reprova a role que puder truncar.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "activity_favorites" TO eventflow_app;
