-- FASE 77 · fatia 2 — presenças por atividade na exportação com prazo (F49)
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   Acrescenta um valor ao enum `DataExportKind`: o pedido de exportação passa a
--   poder descrever o arquivo de PRESENÇAS (formato longo), e não só o diretório e
--   os contatos de patrocinador.
--
-- POR QUE É UM VALOR NOVO, E NÃO UMA COLUNA
--   `data_exports.kind` é o que decide qual projeção o download vai regerar. Um
--   pedido antigo precisa continuar sabendo o que era; renomear ou reaproveitar um
--   valor existente reescreveria a história da trilha.
--
-- POR QUE NÃO HÁ BACKFILL
--   Nenhuma linha existente passa a ser deste tipo: o arquivo de presenças nunca
--   foi exportado antes desta fase.
--
-- `ALTER TYPE ... ADD VALUE` é comutativo e aditivo; não toca em dado nem em RLS
-- (a tabela `data_exports` já está sob policy por instituição).

ALTER TYPE "DataExportKind" ADD VALUE IF NOT EXISTS 'ATTENDANCES_CSV';
