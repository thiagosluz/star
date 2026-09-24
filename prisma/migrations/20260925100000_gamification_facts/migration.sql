-- ═══════════════════════════════════════════════════════════════════════════════
--  OS FATOS QUE FALTAVAM — inscrição, certificado e sorteio (FASE 43)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  ESCRITA À MÃO (armadilha 53)
--  ─────────────────────────────────────────────────────────────────────────────
--  `prisma migrate diff` gera, junto do que é desta fase, RENAME/DROP de índices
--  parciais escritos à mão por fases anteriores (o `schema.prisma` não os declara).
--  Aqui ficou só o que a FASE 43 acrescenta — e ela acrescenta apenas VALORES DE ENUM:
--  nenhuma tabela, nenhuma coluna, nenhum índice.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE ORIGEM PRÓPRIA, EM VEZ DE REAPROVEITAR UMA EXISTENTE
--  ─────────────────────────────────────────────────────────────────────────────
--  `REGISTRATION_CONFIRMED`, `CERTIFICATE_ISSUED` e `RAFFLE_WON` são fatos que já
--  aconteciam no sistema e não moviam nada. Creditá-los como `BONUS` perderia a
--  origem no extrato ("Bônus" não diz de quê) e tornaria impossível responder à
--  pergunta que a instituição faz primeiro: "de onde vem o XP deste evento?".
--
--  O gatilho de carta acompanha a origem de propósito: é o mapeamento explícito de
--  `XP_SOURCE_TO_CARD_TRIGGER` (domínio) que decide se a carta sai, e sem o valor do
--  lado da carta uma colecionável de "sorteado" não teria como ser configurada.
--
--  `ALTER TYPE ... ADD VALUE` não pode ser usado na MESMA transação em que o valor
--  passa a ser gravado — aqui só se acrescenta, então a migração é segura.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Origem de XP ───────────────────────────────────────────────────────────
ALTER TYPE "XpSourceKind" ADD VALUE IF NOT EXISTS 'REGISTRATION_CONFIRMED';
ALTER TYPE "XpSourceKind" ADD VALUE IF NOT EXISTS 'CERTIFICATE_ISSUED';
ALTER TYPE "XpSourceKind" ADD VALUE IF NOT EXISTS 'RAFFLE_WON';

-- ── 2. Gatilho de carta ───────────────────────────────────────────────────────
ALTER TYPE "CardTrigger" ADD VALUE IF NOT EXISTS 'REGISTRATION_CONFIRMED';
ALTER TYPE "CardTrigger" ADD VALUE IF NOT EXISTS 'CERTIFICATE_ISSUED';
ALTER TYPE "CardTrigger" ADD VALUE IF NOT EXISTS 'RAFFLE_WON';
