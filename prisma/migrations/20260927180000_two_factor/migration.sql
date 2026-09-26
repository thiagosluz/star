-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 47 — Segundo fator da conta (`two_factor`)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  A TABELA É DO FLUXO DE AUTENTICAÇÃO, NÃO DE UMA INSTITUIÇÃO
--  ─────────────────────────────────────────────────────────────────────────────
--  Não há `tenantId`: a identidade é global (ADR-002) e o segundo fator protege a
--  CONTA. Como `account` e `verification`, ela é usada antes de existir tenant ativo,
--  então RLS aqui não teria por onde isolar — a proteção é outra (abaixo).
--
--  O que a linha guarda: a SEMENTE do TOTP e os códigos de recuperação, ambos
--  CIFRADOS pela biblioteca (AES-GCM com `BETTER_AUTH_SECRET`). O plugin também
--  mantém `failedVerificationCount` e `lockedUntil`, que são a trava contra força
--  bruta no código de seis dígitos.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE O PRIVILÉGIO É REVOGADO (E NÃO SÓ "SEM RLS")
--  ─────────────────────────────────────────────────────────────────────────────
--  O banco concede CRUD a toda tabela nova para a role de runtime (ALTER DEFAULT
--  PRIVILEGES do provisionamento). `account` convive com isso porque guarda um hash
--  scrypt — que só serve para CONFERIR senha. Aqui não: quem lê a semente TOTP gera
--  códigos válidos e o segundo fator deixa de existir.
--
--  Quem lê e escreve esta tabela é a biblioteca de autenticação, pela conexão de
--  plataforma (`adminPrisma`, invariante nº 1). Revogar é a mesma resposta dada a
--  `job_runs` na FASE 36 — e a verificação de contrato passa a exigir isto para as
--  tabelas de `IDENTITY_ONLY_TABLES`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "two_factor" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_userId_idx" ON "two_factor"("userId");

-- CreateIndex
CREATE INDEX "two_factor_secret_idx" ON "two_factor"("secret");

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A role de runtime NÃO alcança o segredo do segundo fator (nem por engano).
REVOKE ALL ON TABLE "two_factor" FROM "eventflow_app";
REVOKE ALL ON TABLE "two_factor" FROM PUBLIC;
