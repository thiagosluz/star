-- ═══════════════════════════════════════════════════════════════════════════════
--  PERFIL PÚBLICO: O PADRÃO PASSA A SER NÃO PUBLICAR O NOME (FASE 22, ADR-139)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O DEFEITO
--  ─────────────────────────────────────────────────────────────────────────────
--  `"user"."isPublicProfile"` nasceu `BOOLEAN NOT NULL DEFAULT true` na migração
--  inicial, e o domínio do sorteio lê o campo como CONSENTIMENTO EXPLÍCITO: com ele
--  ligado, o resultado público mostra o nome COMPLETO; desligado, mascara
--  (`Ana Souza` → `Ana S.`). Como o campo nunca teve tela nem serviço que o
--  escrevesse, toda conta do sistema nasceu com `true` — ou seja, o efeito real era
--  o OPOSTO do documentado: nome completo publicado por um consentimento que ninguém
--  deu.
--
--  O defeito sobreviveu à FASE 16 porque o teste de integração GRAVAVA o valor que o
--  domínio esperava (`isPublicProfile: false`) em vez de deixar o padrão do banco
--  valer — a fixture escondia exatamente o que a suíte deveria pegar. Foi o teste da
--  página pública da FASE 22 que o encontrou, criando as contas pelo caminho normal.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  A CORREÇÃO
--  ─────────────────────────────────────────────────────────────────────────────
--    1. o padrão passa a ser `false` — não publicar é o estado de quem não escolheu;
--    2. as linhas existentes com `true` voltam para `false`, porque NÃO PODEM
--       representar escolha: nenhum caminho do sistema escreve esta coluna. Quem
--       quiser publicar o nome passa a ter de ligar o campo (tela própria, dívida
--       E35) — e o sentido da mudança é o seguro: mascara mais, nunca menos.
--
--  Nada mais no sistema lê esta coluna (o diretório público e a vitrine de
--  palestrantes usam `SpeakerProfile.isPublic`), então a mudança fica contida no
--  resultado de sorteio.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public."user" ALTER COLUMN "isPublicProfile" SET DEFAULT false;

UPDATE public."user"
   SET "isPublicProfile" = false
 WHERE "isPublicProfile" = true;

COMMENT ON COLUMN public."user"."isPublicProfile" IS
  'true = a pessoa autorizou publicar o nome completo em resultado público (sorteio); false = nome mascarado';
