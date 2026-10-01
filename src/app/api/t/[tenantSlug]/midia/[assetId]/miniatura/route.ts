import { NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { encodeThumbnailAsWebp } from '@/lib/storage/image-converter';
import { getObjectBuffer, inspectObject, putObjectBuffer } from '@/lib/storage/s3-client';

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

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' },
      { status: 404 },
    );
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED', message: 'Entre para ver esta imagem.' },
      { status: 401 },
    );
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.tenantId, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (membership?.status !== 'ACTIVE') {
    return NextResponse.json(
      { ok: false, code: 'FORBIDDEN', message: 'Esta imagem é do acervo da instituição.' },
      { status: 403 },
    );
  }

  const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');

  if (!can(principal, PERMISSIONS.PAGE_MANAGE, { scope: 'TENANT' })) {
    return NextResponse.json(
      { ok: false, code: 'FORBIDDEN', message: 'Você não gerencia o acervo desta instituição.' },
      { status: 403 },
    );
  }

  const asset = await withTenant(tenant.tenantId, (tx) =>
    tx.mediaAsset.findFirst({
      where: { id: assetId, deletedAt: null },
      select: { bucket: true, objectKey: true },
    }),
  );

  if (!asset) {
    return NextResponse.json(
      { ok: false, code: 'NOT_FOUND', message: 'Imagem não encontrada.' },
      { status: 404 },
    );
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
    return NextResponse.json(
      { ok: false, code: 'THUMBNAIL_FAILED', message: thumbnail.message },
      { status: 422 },
    );
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
