-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 50 — origem do ESTORNO no livro-razão de XP (dívida E59)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE UM VALOR PRÓPRIO, E NÃO `ADMIN_ADJUSTMENT`
--  ─────────────────────────────────────────────────────────────────────────────
--  O estorno é um lançamento NEGATIVO que devolve o XP de uma vaga cancelada. Gravado
--  como ajuste administrativo, a trilha diria que a organização mexeu no saldo — e
--  ninguém saberia que a causa foi um cancelamento. A origem própria é o que faz o
--  extrato explicar a si mesmo.
--
--  `ADD VALUE` é aditivo: nenhum lançamento existente muda de sentido, e a ordem dos
--  valores no enum não é contrato (o que é contrato é o NOME).
-- ═══════════════════════════════════════════════════════════════════════════════

-- AlterEnum
ALTER TYPE "XpSourceKind" ADD VALUE IF NOT EXISTS 'REGISTRATION_REVERTED';