-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 48 — link público de carta (`card_share_links`)
--
--  ─────────────────────────────────────────────────────────────────────────────
--  A EXPOSIÇÃO É POR CARTA, E É REVOGÁVEL
--  ─────────────────────────────────────────────────────────────────────────────
--  O perfil público (FASE 44) publica as cartas em destaque, mas nasce FECHADO e
--  expõe de forma permanente: compartilhar UMA carta num grupo não pode obrigar a
--  pessoa a abrir o álbum inteiro. Esta tabela guarda o link de UMA carta, criado
--  por quem a conquistou, e a página que ele abre mostra apenas ela.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  O TOKEN VIVE EM DUAS FORMAS, E AS DUAS SÃO NECESSÁRIAS
--  ─────────────────────────────────────────────────────────────────────────────
--  `tokenHash` (SHA-256, hexadecimal) é o ÍNDICE: a leitura pública acha a linha
--  por ele, sem que o segredo esteja em claro no caminho da consulta.
--  `tokenSealed` é o token CIFRADO (AES-256-GCM com `BETTER_AUTH_SECRET`): sem
--  ele, o dono não conseguiria copiar o link de novo depois de fechar a tela — e
--  regerar a cada visita invalidaria todo link já enviado. Um vazamento do banco,
--  sozinho, não abre link nenhum: falta a chave da aplicação.
--
--  Esta é a diferença em relação ao convite do palestrante (ADR-114), que guarda
--  SÓ o hash e por isso aparece uma única vez: lá o convite é entregue por e-mail
--  ao convidado, aqui o link é do próprio dono e ele precisa poder reexibi-lo.
--
--  ─────────────────────────────────────────────────────────────────────────────
--  POR QUE É TABELA DE INSTITUIÇÃO (RLS + FORCE), E NÃO SÓ COLUNA
--  ─────────────────────────────────────────────────────────────────────────────
--  O dono, o cartão e a data da revogação são dado da instituição onde a carta foi
--  conquistada — e a leitura pública conhece a instituição pelo slug da URL, então
--  isolar por `tenantId` é possível E suficiente: um token de outra instituição
--  simplesmente não é encontrado (fail-closed), sem consulta privilegiada.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "card_share_links" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userCardId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "card_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Um token, uma carta: o índice é ÚNICO porque a leitura pública não pode ter
-- duas linhas candidatas (e porque token repetido seria colisão de sorteio).
CREATE UNIQUE INDEX "card_share_links_tokenHash_key" ON "card_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "card_share_links_tenantId_userId_userCardId_idx" ON "card_share_links"("tenantId", "userId", "userCardId");

-- CreateIndex
CREATE INDEX "card_share_links_tenantId_userCardId_revokedAt_idx" ON "card_share_links"("tenantId", "userCardId", "revokedAt");

-- AddForeignKey
ALTER TABLE "card_share_links" ADD CONSTRAINT "card_share_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_share_links" ADD CONSTRAINT "card_share_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apagar a linha do álbum apaga o link: o link não sobrevive à conquista.
ALTER TABLE "card_share_links" ADD CONSTRAINT "card_share_links_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "user_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: ENABLE + FORCE + policy ──────────────────────────────────────────────
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['card_share_links']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', tabela);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = format('public.%I', tabela)::regclass
         AND polname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I
           USING ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)
           WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)',
        tabela
      );
    END IF;
  END LOOP;
END
$$;

-- ── GRANTs para a role de runtime ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_share_links TO eventflow_app;
