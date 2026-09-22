-- ─────────────────────────────────────────────────────────────────────────────
--  FASE 33 — bloco "Chamadas de propostas" na página pública
--
--  O bloco novo da landing page é uma CHAVE DE ENUM, e não uma tabela: o tipo mora
--  em `PageBlockType`, e a página pública já descarta tipo desconhecido
--  (`selectRenderableBlocks`) — o que faria a chamada sumir em silêncio se o valor
--  existisse no domínio e não no banco.
--
--  `ADD VALUE IF NOT EXISTS` é idempotente de propósito: reaplicar a migração num
--  banco que já recebeu o valor não é erro. O valor NÃO é usado nesta migração (a
--  regra do PostgreSQL é que o rótulo novo só pode ser usado depois do COMMIT), e
--  por isso ele entra sozinho, sem nenhum INSERT ou UPDATE junto.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "PageBlockType" ADD VALUE IF NOT EXISTS 'CALL_FOR_PROPOSALS' BEFORE 'CUSTOM_HTML';
