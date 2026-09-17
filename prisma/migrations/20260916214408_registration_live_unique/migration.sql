-- ═══════════════════════════════════════════════════════════════════════════════
--  Unicidade de inscrição VIVA + ordem da lista de espera
--
--  ─────────────────────────────────────────────────────────────────────────────
--  1. POR QUE O ÍNDICE ÚNICO GLOBAL FOI REMOVIDO
--  ─────────────────────────────────────────────────────────────────────────────
--  O índice `(activityId, userId)` sem filtro impedia um participante de se
--  inscrever novamente depois de cancelar, porque a linha do cancelamento
--  permanece na tabela (CANCELED é estado terminal, para preservar o histórico
--  e a auditoria de promoções da lista de espera).
--
--  A solução é um índice único PARCIAL: a unicidade vale apenas entre
--  inscrições "vivas". Cancelar libera o par (activityId, userId) para uma nova
--  inscrição, sem apagar o registro anterior.
--
--  Isto é a garantia DEFINITIVA contra inscrição duplicada sob concorrência:
--  mesmo que a checagem em JavaScript perca a corrida, o banco rejeita.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  2. POR QUE A POSIÇÃO NA LISTA DE ESPERA PRECISA DE ÍNDICE ÚNICO
--  ─────────────────────────────────────────────────────────────────────────────
--  A posição é calculada em JavaScript (`MAX(waitlistPosition) + 1`) dentro da
--  transação. Duas requisições simultâneas podem ler o mesmo máximo e tentar a
--  MESMA posição — um clássico TOCTOU. Sem restrição no banco, ambas gravam e a
--  fila fica com posições duplicadas, corrompendo a ordem FIFO.
--
--  Com o índice único parcial abaixo, a segunda transação falha, a camada de
--  aplicação captura o erro e recalcula a posição. O resultado é uma fila
--  sempre contígua, sem duplicatas, resistente a concorrência real.
--
--  O filtro `IS NOT NULL` é essencial: inscrições CONFIRMED têm
--  `waitlistPosition = NULL`, e no PostgreSQL múltiplos NULLs não conflitam
--  entre si em índice único — exatamente o comportamento desejado.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Remove a unicidade global (impedia reinscrição após cancelar) ─────────
DROP INDEX IF EXISTS "registrations_activityId_userId_key";

-- ─── 2. Unicidade apenas entre inscrições vivas ───────────────────────────────
CREATE UNIQUE INDEX "registrations_live_activity_user_key"
  ON "registrations" ("activityId", "userId")
  WHERE status IN ('PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED');

-- ─── 3. Ordem da lista de espera sem duplicatas ───────────────────────────────
CREATE UNIQUE INDEX "registrations_waitlist_position_key"
  ON "registrations" ("activityId", "waitlistPosition")
  WHERE status = 'WAITLISTED' AND "waitlistPosition" IS NOT NULL;

-- ─── 4. Índice de apoio para localizar a fila rapidamente ────────────────────
CREATE INDEX "registrations_activity_waitlist_idx"
  ON "registrations" ("activityId", "waitlistPosition")
  WHERE status = 'WAITLISTED';
