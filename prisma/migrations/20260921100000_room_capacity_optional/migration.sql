-- ═══════════════════════════════════════════════════════════════════════════════
--  CAPACIDADE DE SALA PASSA A SER OPCIONAL (revisão da FASE 3)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE MUDA, E POR QUÊ
--  ─────────────────────────────────────────────────────────────────────────────
--  `rooms."capacity"` nasceu `integer NOT NULL DEFAULT 0`. O `DEFAULT 0` era um
--  problema de SIGNIFICADO, não de tipo: toda sala criada sem capacidade declarada
--  passava a afirmar "zero lugares" — e o domínio tinha de reinterpretar o 0 como
--  "sala sem limite definido" (`evaluateRoomFit`), porque tratar zero lugares como
--  limite real bloquearia qualquer atividade naquela sala.
--
--  Duas afirmações diferentes ("não cabe ninguém" e "não há limite") moravam no
--  mesmo valor. Esta migração separa as duas:
--
--    NULL  = a sala NÃO tem limite definido (a lotação da atividade manda);
--    n > 0 = a sala comporta n pessoas e passa a ser o TETO do limite efetivo da
--            atividade que acontece nela (inclusive na reserva de vaga).
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE **NÃO** MUDA
--  ─────────────────────────────────────────────────────────────────────────────
--  Nada de comportamento para o que já existe: `evaluateRoomFit` sempre leu
--  `capacidade <= 0` como "sem limite", então normalizar os zeros para NULL
--  preserva exatamente a leitura anterior. Nenhuma atividade perde vaga, nenhuma
--  inscrição é tocada, e nenhuma sala passa a bloquear mais do que bloqueava.
--
--  A tabela `rooms` já tem RLS + FORCE e a policy de isolamento (FASE 1) — coluna
--  nova não depende de policy, e a coluna alterada herda as duas.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Sem DEFAULT e sem NOT NULL: a ausência de limite é NULL ───────────────
ALTER TABLE public.rooms ALTER COLUMN "capacity" DROP DEFAULT;
ALTER TABLE public.rooms ALTER COLUMN "capacity" DROP NOT NULL;

-- ── 2. As salas que herdaram o antigo DEFAULT passam a dizer a verdade ───────
-- `capacity <= 0` não é uma capacidade: é uma omissão. O domínio já a lia assim.
UPDATE public.rooms
   SET "capacity" = NULL
 WHERE "capacity" IS NOT NULL
   AND "capacity" <= 0;

COMMENT ON COLUMN public.rooms."capacity" IS
  'NULL = sala sem limite definido; n > 0 = capacidade da sala, que é o teto do limite efetivo da atividade';
