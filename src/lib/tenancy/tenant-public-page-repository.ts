/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Repositório da página pública da instituição
 *                                                            (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TUDO AQUI RODA SOB `withTenant` — INCLUSIVE A LEITURA ANÔNIMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem lê a página pública é um visitante SEM SESSÃO, e é tentador tratar isso
 *  como "leitura livre". Não é: o slug da URL é entrada de estranho, e a página de
 *  uma instituição não pode ser alcançada a partir do contexto de outra. Por isso a
 *  leitura entra em `withTenant(tenantId)` como qualquer consulta de aplicação — a
 *  RLS é a última linha (invariante nº 3), e `adminPrisma` não aparece neste
 *  arquivo.
 *
 *  A resolução slug→id acontece ANTES, no chamador (`getTenantContext`, que lê a
 *  tabela GLOBAL `tenants`): é ela que descobre em que contexto estamos, então é a
 *  única que não pode rodar sob contexto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O REPOSITÓRIO NÃO DECIDE NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele lê colunas e devolve a forma crua. A validação do conteúdo é do domínio
 *  (`validateTenantPage`), a decisão de rascunho × publicado é do domínio
 *  (`resolveTenantPagePublication`), e a normalização de um tema inválido é de
 *  `resolveTheme`. Aqui não existe `if` de regra: existe `select`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import {
  readTenantPageSnapshot,
  type TenantPageBlock,
  type TenantPageSnapshot,
} from '@/domain/tenancy/tenant-public-page';

/** A linha como ela sai do banco — o que a leitura e a gravação compartilham. */
export interface TenantPublicPageRow {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  /** `unknown`: o Json do banco é validado no domínio, não no repositório. */
  theme: unknown;
  blocks: TenantPageBlock[];
  publishedSnapshot: TenantPageSnapshot | null;
  publishedAt: Date | null;
  publishedById: string | null;
  updatedAt: Date;
}

const PAGE_SELECT = {
  id: true,
  tenantId: true,
  title: true,
  description: true,
  coverImageUrl: true,
  logoUrl: true,
  theme: true,
  blocks: true,
  publishedSnapshot: true,
  publishedAt: true,
  publishedById: true,
  updatedAt: true,
} as const;

/**
 * Lê a página da instituição — o rascunho E a versão publicada.
 *
 * Devolve `null` quando a instituição ainda não criou a página. É a resposta
 * correta e não um erro: a página é criada no primeiro acesso do organizador ao
 * editor (fatia 3), e uma instituição que nunca abriu o editor não tem linha.
 */
export async function findTenantPublicPage(
  tenantId: string,
  tx?: TxClient,
): Promise<TenantPublicPageRow | null> {
  const run = async (client: TxClient) => {
    const row = await client.tenantPublicPage.findFirst({
      where: { tenantId },
      select: PAGE_SELECT,
    });

    return row === null ? null : toRow(row);
  };

  return tx ? run(tx) : withTenant(tenantId, run);
}

/** O rascunho como snapshot — a forma que a validação e a publicação consomem. */
export function toDraftSnapshot(row: TenantPublicPageRow): TenantPageSnapshot {
  return {
    title: row.title,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    logoUrl: row.logoUrl,
    theme: row.theme,
    blocks: row.blocks,
  };
}

/**
 * Cria a linha da página, vazia e despublicada.
 *
 * `publishedSnapshot` fica NULO e não "uma cópia do rascunho": nascer publicado é a
 * diferença entre montar e publicar, e a página de uma instituição não deve ir ao ar
 * porque alguém abriu o editor.
 */
export async function insertTenantPublicPage(
  tx: TxClient,
  input: { id: string; tenantId: string; snapshot: TenantPageSnapshot },
): Promise<void> {
  await tx.tenantPublicPage.create({
    data: {
      id: input.id,
      tenantId: input.tenantId,
      title: input.snapshot.title,
      description: input.snapshot.description,
      coverImageUrl: input.snapshot.coverImageUrl,
      logoUrl: input.snapshot.logoUrl,
      theme: input.snapshot.theme as object,
      blocks: input.snapshot.blocks as unknown as object,
    },
  });
}

/**
 * Grava o RASCUNHO — nunca a versão publicada.
 *
 * A separação é o ponto do desenho: este `update` toca as colunas do topo e deixa
 * `publishedSnapshot`/`publishedAt` intactos, então salvar no editor não muda o que
 * o visitante vê.
 */
export async function updateTenantPublicPageDraft(
  tx: TxClient,
  input: { pageId: string; snapshot: TenantPageSnapshot },
): Promise<void> {
  await tx.tenantPublicPage.update({
    where: { id: input.pageId },
    data: {
      title: input.snapshot.title,
      description: input.snapshot.description,
      coverImageUrl: input.snapshot.coverImageUrl,
      logoUrl: input.snapshot.logoUrl,
      theme: input.snapshot.theme as object,
      blocks: input.snapshot.blocks as unknown as object,
    },
  });
}

/**
 * Publica: copia o snapshot para as colunas do publicado.
 *
 * A cópia AQUI (e não uma referência ao rascunho) é o que torna a versão publicada
 * imutável na prática: o próximo `update` do rascunho não alcança este snapshot.
 */
export async function publishTenantPublicPage(
  tx: TxClient,
  input: { pageId: string; snapshot: TenantPageSnapshot; actorId: string; publishedAt: Date },
): Promise<void> {
  await tx.tenantPublicPage.update({
    where: { id: input.pageId },
    data: {
      publishedSnapshot: input.snapshot as unknown as object,
      publishedAt: input.publishedAt,
      publishedById: input.actorId,
    },
  });
}

/**
 * Despublica: tira a versão do ar SEM apagar o rascunho.
 *
 * O snapshot volta a `{}` (o vazio que `readTenantPageSnapshot` lê como "nunca
 * publicada") porque "fora do ar" e "publicado com data antiga" precisam ser
 * distinguíveis: se o snapshot ficasse guardado, a tela mostraria "publicada em
 * 12/03" para uma página que não está no ar.
 */
export async function unpublishTenantPublicPage(tx: TxClient, pageId: string): Promise<void> {
  await tx.tenantPublicPage.update({
    where: { id: pageId },
    data: { publishedSnapshot: {}, publishedAt: null, publishedById: null },
  });
}

/**
 * Um `select` do Prisma devolve `JsonValue`; o repositório traduz para a forma do
 * domínio.
 *
 * O `publishedSnapshot` passa por `readTenantPageSnapshot`, que devolve `null` para
 * um valor sem a forma mínima. É o que faz uma linha corrompida virar "nunca
 * publicada" em vez de uma página desenhada a partir de `undefined`.
 */
function toRow(row: {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  theme: unknown;
  blocks: unknown;
  publishedSnapshot: unknown;
  publishedAt: Date | null;
  publishedById: string | null;
  updatedAt: Date;
}): TenantPublicPageRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    logoUrl: row.logoUrl,
    theme: row.theme,
    blocks: Array.isArray(row.blocks) ? (row.blocks as TenantPageBlock[]) : [],
    publishedSnapshot: readTenantPageSnapshot(row.publishedSnapshot),
    publishedAt: row.publishedAt,
    publishedById: row.publishedById,
    updatedAt: row.updatedAt,
  };
}
