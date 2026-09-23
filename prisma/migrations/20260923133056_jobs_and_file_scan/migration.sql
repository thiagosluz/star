-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 36 — Rotinas automáticas sob o worker e inspeção de arquivos
--
--  Migração escrita À MÃO (armadilha 53): o `prisma migrate dev --create-only`
--  gerou, além destas linhas, o ruído conhecido — DROP INDEX de cinco índices
--  criados à mão em fases anteriores, DROP DEFAULT de colunas `id`/`updatedAt`/
--  `snapshot`, renames de constraints e um `ALTER TYPE ... JSONB` de outra fase.
--  Nada disso entra: não pertence a esta entrega.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── O registro (e a exclusão mútua) das rotinas automáticas ──────────────────
CREATE TABLE "job_runs" (
  "id"            UUID           NOT NULL,
  "job"           VARCHAR(60)    NOT NULL,
  "status"        VARCHAR(20)    NOT NULL DEFAULT 'RUNNING',
  "trigger"       VARCHAR(20)    NOT NULL DEFAULT 'SCHEDULE',
  "startedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMPTZ(6),
  "items"         INTEGER        NOT NULL DEFAULT 0,
  "error"         TEXT,
  "triggeredById" UUID,
  "host"          VARCHAR(120),
  CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_runs_job_startedAt_idx" ON "job_runs" ("job", "startedAt");
CREATE INDEX "job_runs_status_startedAt_idx" ON "job_runs" ("status", "startedAt");

-- ── UMA execução em andamento por rotina (o "claim") ──────────────────────────
--
--  É este índice que substitui o advisory lock de sessão: sob PgBouncer em modo
--  TRANSAÇÃO a conexão troca entre comandos, e um lock de sessão não sobrevive —
--  dois workers achariam que têm o lock (ADR-186). A exclusão mútua é decidida
--  pelo BANCO, como toda concorrência neste projeto (invariante nº 5).
CREATE UNIQUE INDEX "job_runs_running_key"
  ON "job_runs" ("job")
  WHERE "status" = 'RUNNING';

-- ─── Inspeção de arquivos: o material do palestrante ganha a mesma semântica ──
-- `submission_files.scanStatus` já existe desde a migração inicial; faltavam a
-- data e o motivo nos dois lados.
ALTER TABLE "speaker_materials"
  ADD COLUMN "scanStatus"  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "scannedAt"   TIMESTAMPTZ(6),
  ADD COLUMN "scanMessage" VARCHAR(300);

ALTER TABLE "submission_files"
  ADD COLUMN "scannedAt"   TIMESTAMPTZ(6),
  ADD COLUMN "scanMessage" VARCHAR(300);
