-- ═══════════════════════════════════════════════════════════════════════════════
--  job_runs é tabela de PLATAFORMA: a role de runtime não tem acesso (FASE 36)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE ESTE REVOKE EXISTE
--  ─────────────────────────────────────────────────────────────────────────────
--  O banco concede, por padrão, SELECT/INSERT/UPDATE/DELETE em toda tabela nova
--  para a role `eventflow_app` (é o ALTER DEFAULT PRIVILEGES do provisionamento).
--  Isso é o que se quer para as tabelas de instituição — que recebem RLS logo em
--  seguida — e é uma armadilha para as de PLATAFORMA: `job_runs` nasceu sem RLS (não
--  há `tenantId` por onde isolar: a passada é de todas as instituições), então a role
--  de runtime poderia **ler o histórico operacional** (host, erro, rotina) e até
--  **reservar** uma rotina inserindo uma linha `RUNNING`, travando o worker.
--
--  A resposta certa não é inventar uma policy para uma tabela que não pertence a
--  instituição nenhuma: é **tirar o privilégio**. Quem lê e escreve `job_runs` é a
--  conexão de plataforma (`adminPrisma`, em `src/lib/platform/**`), a mesma que
--  governa instituições — invariante nº 1.
--
--  O contrato (`prisma/scripts/assert-schema-contract.mjs`) passou a verificar isto:
--  tabela de plataforma com privilégio para a role de runtime **reprova** a bateria.
--  Foi a verificação de contrato que encontrou esta abertura, antes de qualquer
--  revisão humana.
-- ═══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON TABLE "job_runs" FROM "eventflow_app";
REVOKE ALL ON TABLE "job_runs" FROM PUBLIC;
