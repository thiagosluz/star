import { NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { encodeThumbnailAsWebp } from '@/lib/storage/image-converter';
import { getObjectBuffer, inspectObject, putObjectBuffer } from '@/lib/storage/s3-client';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MINIATURA DE UMA IMAGEM DO ACERVO (FASE 56 · dívida E18)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A galeria do acervo desenhava cada imagem INTEIRA dentro de um quadrado de ~200 px.
 *  Com vinte fotos de 3 MB, abrir a tela baixava dezenas de megabytes para mostrar
 *  vinte quadrados — e cada visita repetia o download, porque o navegador não guarda em
 *  cache o que não tem cabeçalho de cache.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A MINIATURA É GERADA NA PRIMEIRA VISITA, E NÃO NO ENVIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Gerar no envio exigiria uma coluna nova, um passo a mais em todo upload e uma
 *  migração de dados para tudo o que já está no bucket — e o acervo tem imagens de
 *  antes da FASE 46 que NUNCA passaram pela esteira do WebP. Gerando na leitura, o
 *  acervo inteiro ganha miniatura na primeira vez que alguém o abre, sem tocar em dado.
 *
 *  A segunda visita é barata: a miniatura fica no MESMO bucket, com o prefixo
 *  `thumbs/`, e o `HEAD` responde antes de qualquer decodificação. Miniatura órfã (o
 *  original foi apagado) não vira lixo de verdade: ela é derivada, e o `deleteMediaAsset`
 *  apaga as duas quando alguém olhar (ver `E65` no documento da fase).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM PODE PEDIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `page:manage`, a MESMA permissão da tela do acervo — a imagem do acervo é material
 *  de trabalho da organização, e a rota não pode virar um caminho de leitura paralelo
 *  ao da página. O vínculo é conferido no banco (sem vínculo ativo não há principal).
 */
export const dynamic = 'force-dynamic';

/** Prefixo das miniaturas dentro do bucket do acervo. */
const THUMBNAIL_PREFIX = 'thumbs/';

/**
 * Um mês: a miniatura é derivada de um original imutável (o conteúdo do objeto não
 * muda sem virar outro objeto), então ela pode ser guardada por muito tempo.
 */
const THUMBNAIL_CACHE_SECONDS = 60 * 60 * 24 * 30;

function imageResponse(bytes: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': `public, max-age=${THUMBNAIL_CACHE_SECONDS}, immutable`,
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantSlug: string; assetId: string }> },
): Promise<NextResponse> {
  const { tenantSlug, assetId } = await context.params;

  /**
   * ─── O FORMATO É PERGUNTA DE ENDEREÇO, E VEM ANTES DE TUDO (FASE 76) ────────
   * `assetId` é o caminho do recurso: sem uuid não há o que procurar. A validação
   * aqui evita o 500 mudo do Prisma (`P2023`) e responde o MESMO 404 de um uuid bem
   * formado que não existe — para o cliente, as duas coisas são "não achei".
   */
  if (!isUuid(assetId)) {
    return tenantApiError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  }

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return tenantApiError(404, 'NOT_FOUND', 'Instituição não encontrada.');
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return tenantApiError(401, 'UNAUTHENTICATED', 'Entre para ver esta imagem.');
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.tenantId, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (membership?.status !== 'ACTIVE') {
    return tenantApiError(403, 'FORBIDDEN', 'Esta imagem é do acervo da instituição.');
  }

  const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');

  if (!can(principal, PERMISSIONS.PAGE_MANAGE, { scope: 'TENANT' })) {
    return tenantApiError(403, 'FORBIDDEN', 'Você não gerencia o acervo desta instituição.');
  }

  const asset = await withTenant(tenant.tenantId, (tx) =>
    tx.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      select: { bucket: true, objectKey: true },
    }),
  );

  if (!asset) {
    return tenantApiError(404, 'NOT_FOUND', 'Imagem não encontrada.');
  }

  const thumbnailKey = `${THUMBNAIL_PREFIX}${asset.objectKey}.webp`;

  /**
   * ── A MINIATURA JÁ EXISTE? ─────────────────────────────────────────────────
   * O `HEAD` responde sem baixar bytes: é o caminho da segunda visita em diante, e é
   * ele que faz a galeria abrir rápido depois da primeira vez.
   */
  const cached = await inspectObject(asset.bucket, thumbnailKey);

  if (cached.exists) {
    const bytes = await getObjectBuffer(asset.bucket, thumbnailKey);
    return imageResponse(bytes);
  }

  const original = await getObjectBuffer(asset.bucket, asset.objectKey);
  const thumbnail = await encodeThumbnailAsWebp({ bytes: original });

  if (!thumbnail.ok) {
    return tenantApiError(422, 'THUMBNAIL_FAILED', thumbnail.message);
  }

  /**
   * A gravação é o CACHE, e falhar nela não pode negar a imagem: quem pediu a miniatura
   * precisa dela agora — a próxima visita é que paga o custo de gerar de novo.
   */
  try {
    await putObjectBuffer({
      bucket: asset.bucket,
      objectKey: thumbnailKey,
      body: thumbnail.bytes,
      contentType: 'image/webp',
      metadata: { derivedFrom: asset.objectKey },
    });
  } catch (error) {
    console.error(
      `[acervo] miniatura gerada, mas não guardada (${thumbnailKey}):`,
      error instanceof Error ? error.message : error,
    );
  }

  return imageResponse(thumbnail.bytes);
}
