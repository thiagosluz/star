-- ═══════════════════════════════════════════════════════════════════════════════
--  A LISTA PUBLICADA DO SORTEIO (FASE 29)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE MUDA, E POR QUÊ
--  ─────────────────────────────────────────────────────────────────────────────
--  A apuração sempre soube QUEM eram os elegíveis (com quantos minutos cada um), e
--  jogava essa lista fora: gravava só `eligibleCount`. O resultado ficava auditável
--  pelo hash, mas NÃO reproduzível — e a página pública prometia justamente a
--  reprodução ("o resultado se reproduz rodando o sorteio com a semente"). Sem a
--  entrada do sorteio, ninguém podia conferir a promessa.
--
--  `poolSnapshot` guarda a lista EXATAMENTE como o sorteio a consumiu: a ordem
--  (que decide o desempate do sorteio ponderado), o código público estável de cada
--  participante (`P-…`, derivado de sorteio + participante) e os minutos. O código
--  substitui o `userId` no documento público: a conferência não precisa de
--  identidade, e publicar identificadores internos seria exposição sem ganho.
--
--  `poolHash` é o SHA-256 do documento canônico da lista e entra no payload do
--  resultado a partir da versão 3 (`raffles."resultVersion" = 3`): mexer na lista, na
--  ordem ou nos minutos de alguém passa a mudar o hash do RESULTADO — antes, trocar
--  a lista deixava o hash intacto.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O QUE **NÃO** MUDA
--  ─────────────────────────────────────────────────────────────────────────────
--  Apurações já gravadas ficam com as duas colunas NULAS e seguem verificáveis pelo
--  payload da versão que usaram (1 ou 2) — o hash delas continua conferindo, porque
--  a reconstrução do payload é por versão. A trilha de auditoria antiga não vira
--  "resultado adulterado" da noite para o dia, que é a mesma regra das versões
--  anteriores (FASE 16).
--
--  As colunas são ANULÁVEIS de propósito: `NULL` significa "apurado antes desta
--  fase" (ou "apurado sem cofre"), e a página de auditoria diz isso em vez de
--  inventar uma lista vazia que pareceria um sorteio sem elegíveis.
--
--  `raffles` já tem RLS + FORCE e a policy de isolamento (FASE 1) — coluna nova não
--  depende de policy, e a tabela herda a existente.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS "poolSnapshot" jsonb;

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS "poolHash" char(64);

COMMENT ON COLUMN public.raffles."poolSnapshot" IS
  'Lista publicada do sorteio na ordem consumida pela apuração: [{ index, code, minutes }] (FASE 29)';

COMMENT ON COLUMN public.raffles."poolHash" IS
  'SHA-256 da lista canônica (poolSnapshot); entra no payload do resultado desde a versão 3';
