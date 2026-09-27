-- ═══════════════════════════════════════════════════════════════════════════════
--  UMA SESSÃO ABERTA POR PESSOA E POR CONTEXTO (defeito achado na bateria da FASE 48)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O DEFEITO
--  ─────────────────────────────────────────────────────────────────────────────
--  A FASE 31 estabeleceu "uma sessão por visita" — a sessão é a chave de
--  idempotência da frequência. O caminho da PRIMEIRA visita é seguro: ele passa
--  pelo `updateMany` condicional do credenciamento (`checkedInAt: null`), e quem
--  perde a corrida recebe 0 linhas e ouve "já está dentro".
--
--  O caminho da SEGUNDA visita (a pessoa saiu para o almoço e voltou) criava a
--  sessão lendo antes de inserir. Dois leitores do MESMO crachá, no mesmo instante,
--  liam "não há sessão aberta" e INSERIAM OS DOIS: duas sessões abertas para a
--  mesma visita. Reproduzido em 1 de 5 execuções de dois `recordCredentialPresence`
--  simultâneos (`['CHECKED_IN','CHECKED_IN']`, 2 linhas abertas) — e o efeito no
--  produto é a frequência contada em dobro.
--
--  É a violação do invariante nº 5 do projeto ("concorrência é decidida no banco"):
--  ler-e-inserir não é decisão, é palpite.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  A DECISÃO
--  ─────────────────────────────────────────────────────────────────────────────
--  O banco passa a decidir, com índice ÚNICO PARCIAL nos dois contextos de leitura:
--   • atividade — uma sessão aberta por (instituição, atividade, pessoa);
--   • portaria   — uma chegada aberta por (instituição, evento, pessoa), que é o
--     contexto quando a leitura não é de uma atividade.
--
--  O índice é PARCIAL (`WHERE "checkedOutAt" IS NULL`) porque várias sessões
--  FECHADAS da mesma pessoa na mesma atividade são o funcionamento normal (as
--  visitas do dia). Quem perde a corrida agora recebe violação de unicidade, e o
--  serviço responde a MESMA coisa que o caminho de "já está dentro" — com a sessão
--  que o vencedor abriu, para o monitor ver os minutos certos.
--
--  Conferido antes de aplicar: nenhuma linha existente viola os índices (a
--  consulta de duplicatas devolveu 0 nos dois contextos).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX "attendances_open_session_activity_key"
  ON "attendances" ("tenantId", "activityId", "userId")
  WHERE "checkedOutAt" IS NULL AND "activityId" IS NOT NULL;

CREATE UNIQUE INDEX "attendances_open_session_event_key"
  ON "attendances" ("tenantId", "eventId", "userId")
  WHERE "checkedOutAt" IS NULL AND "activityId" IS NULL;
