-- ═══════════════════════════════════════════════════════════════════════════════
--  VERSÃO DA CHAVE DO COFRE DE SEMENTES (FASE 22, item G12)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE MUDA, E POR QUÊ
--  ─────────────────────────────────────────────────────────────────────────────
--  A chave que sela a semente de um sorteio (AES-256-GCM) era DERIVADA de
--  `BETTER_AUTH_SECRET`. Trocar esse segredo — rotação de credencial, resposta a
--  incidente — tornava impossível abrir qualquer semente ainda selada: a apuração
--  continuava acontecendo (cai para o gerador do sistema), mas PERDIA a prova de
--  commit-reveal, que é justamente a razão de o cofre existir. A degradação era
--  silenciosa e só aparecia na hora de conferir um sorteio antigo.
--
--  Esta coluna grava QUAL chave selou cada semente. A abertura passa a usar a versão
--  GRAVADA, e não a atual — então girar a chave não invalida nada do que já existe,
--  e a chave antiga pode sair do arquivo depois que não houver mais selo dela.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE **NÃO** MUDA
--  ─────────────────────────────────────────────────────────────────────────────
--  Todo sorteio já gravado recebe `0` = chave LEGADA, que é exatamente a chave que
--  ele usou: a fórmula antiga (`sha256('eventflow:raffle-seed:' + BETTER_AUTH_SECRET)`)
--  continua sendo a da versão 0, byte a byte. Nenhum compromisso publicado perde a
--  prova, nenhuma semente precisa ser resselada e nenhuma apuração muda de resultado.
--
--  `raffles` já tem RLS + FORCE e a policy de isolamento (FASE 1) — coluna nova não
--  depende de policy, e a tabela herda a existente.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS "seedKeyVersion" integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.raffles."seedKeyVersion" IS
  'Versão da chave do cofre usada para selar a semente (0 = legada, derivada de BETTER_AUTH_SECRET)';
