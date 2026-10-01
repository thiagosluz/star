import { withTenant } from '@/lib/db/tenant-client';
import { collectUsages } from '@/lib/admin/media-asset-service';
import { encodeAssetAsWebp } from '@/lib/storage/image-converter';
import { deleteObject, getObjectBuffer, putObjectBuffer } from '@/lib/storage/s3-client';
import {
  STORED_IMAGE_MIME,
  WEBP_POLICY,
  webpKeyFor,
  type ImageTarget,
} from '@/domain/events/image-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REPROCESSAMENTO DO ACERVO EM WEBP (FASE 56 · dívida E65)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO FAZ, E O QUE ELE RECUSA FAZER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Converte para WebP as imagens do acervo que ficaram em PNG/JPEG — tudo o que foi
 *  enviado ANTES da esteira da FASE 46. A conversão grava em CHAVE NOVA
 *  (`webpKeyFor`), porque um `.png` com bytes de WebP é uma mentira gravada no bucket:
 *  cache, CDN e navegador leem a extensão.
 *
 *  Só que a URL faz parte das REFERÊNCIAS — capa do evento, logotipo de patrocinador,
 *  foto de palestrante e o JSON dos blocos da página. Então **imagem em uso é
 *  PULADA**, e o resumo conta quantas foram: reescrever referência é outro trabalho,
 *  com risco próprio, e a pendência tem nome (dívida **E78**).
 *
 *  A régua de "em uso" é a MESMA da biblioteca do acervo (`collectUsages`). Uma
 *  segunda definição de uso faria o script converter o que a tela considera em uso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DAS ESCRITAS IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Objeto novo → linha apontando para ele → só então o original é apagado. Invertido,
 *  uma falha no meio deixaria a linha apontando para um objeto que não existe — e a
 *  imagem sumiria da página em vez de continuar pesada.
 */
export interface ReprocessSummary {
  tenants: number;
  scanned: number;
  converted: number;
  skippedInUse: number;
  skippedUnsupported: number;
  failures: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface ReprocessOptions {
  /** Não escreve nada: só relata o que faria. */
  dryRun?: boolean;
  /** Teto de imagens examinadas por instituição. */
  limit?: number;
  /** Restringe a uma instituição (slug). */
  tenantIds?: string[];
  /** Progresso, quando quem chamou quer narrar. */
  onProgress?: (message: string) => void;
}

/** O alvo do acervo é o MESMO do domínio — a política do WebP é que decide a conversão. */
function isConvertibleTarget(target: string): target is ImageTarget {
  return target in WEBP_POLICY;
}

export async function reprocessMediaAssets(
  tenantIds: string[],
  options: ReprocessOptions = {},
): Promise<ReprocessSummary> {
  const summary: ReprocessSummary = {
    tenants: 0,
    scanned: 0,
    converted: 0,
    skippedInUse: 0,
    skippedUnsupported: 0,
    failures: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };

  for (const tenantId of tenantIds) {
    summary.tenants += 1;

    const partial = await withTenant(tenantId, async (tx) => {
      const usage = await collectUsages(tx, tenantId);

      const candidates = await tx.mediaAsset.findMany({
        where: {
          tenantId,
          deletedAt: null,
          mimeType: { not: STORED_IMAGE_MIME },
        },
        select: {
          id: true,
          bucket: true,
          objectKey: true,
          url: true,
          mimeType: true,
          sizeBytes: true,
          target: true,
        },
        orderBy: { createdAt: 'asc' },
        take: options.limit !== undefined ? options.limit : undefined,
      });

      return { candidates, usedUrls: new Set(usage.keys()) };
    });

    for (const asset of partial.candidates) {
      summary.scanned += 1;

      if (partial.usedUrls.has(asset.url)) {
        summary.skippedInUse += 1;
        continue;
      }

      if (!isConvertibleTarget(asset.target)) {
        summary.skippedUnsupported += 1;
        continue;
      }

      summary.bytesBefore += asset.sizeBytes;

      if (options.dryRun) {
        summary.converted += 1;
        continue;
      }

      try {
        const original = await getObjectBuffer(asset.bucket, asset.objectKey);
        const conversion = await encodeAssetAsWebp({
          bytes: original,
          target: asset.target,
          sourceMime: asset.mimeType as Parameters<typeof encodeAssetAsWebp>[0]['sourceMime'],
        });

        if (!conversion.ok) {
          summary.failures += 1;
          options.onProgress?.(`✗ ${asset.objectKey}: ${conversion.message}`);
          continue;
        }

        const finalObjectKey = webpKeyFor(asset.objectKey);

        const stored = await putObjectBuffer({
          bucket: asset.bucket,
          objectKey: finalObjectKey,
          body: conversion.bytes,
          contentType: STORED_IMAGE_MIME,
          metadata: { reprocessedFrom: asset.objectKey, originalMime: asset.mimeType },
        });

        await withTenant(tenantId, (tx) =>
          tx.mediaAsset.update({
            where: { id: asset.id },
            data: {
              objectKey: finalObjectKey,
              url: asset.url.replace(asset.objectKey, finalObjectKey),
              mimeType: STORED_IMAGE_MIME,
              sizeBytes: stored.sizeBytes,
              checksum: stored.checksum,
            },
          }),
        );

        await deleteObject(asset.bucket, asset.objectKey).catch((error: unknown) => {
          options.onProgress?.(
            `! convertido, mas o original ${asset.objectKey} ficou no bucket: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });

        summary.converted += 1;
        summary.bytesAfter += stored.sizeBytes;

        if (summary.converted % 25 === 0) {
          options.onProgress?.(`… ${summary.converted} convertidas`);
        }
      } catch (error) {
        summary.failures += 1;
        options.onProgress?.(
          `✗ ${asset.objectKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return summary;
}
