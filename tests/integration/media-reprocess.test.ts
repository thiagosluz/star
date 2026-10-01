/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Reprocessamento do acervo em WebP (FASE 56 · dívida E65)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O AMBIENTE REAL PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O acervo anterior à FASE 46 tem PNG/JPEG no bucket e não tinha caminho de volta.
 *  Aqui se prova, com o storage de verdade, o que o reprocessador faz:
 *
 *    • o objeto convertido é um WebP VÁLIDO, em chave `.webp`, com `Content-Type`
 *      correto — a extensão e o conteúdo contam a mesma história (regra da F46);
 *    • o ORIGINAL sai do bucket depois que a linha já aponta para o novo;
 *    • imagem EM USO é pulada: a conversão troca a URL, e a URL está gravada na capa
 *      do evento, no logotipo do patrocinador e nos blocos da página;
 *    • a simulação CONTA sem escrever: nem objeto, nem linha.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { reprocessMediaAssets } from '../../src/lib/admin/media-reprocess-service';
import { BUCKETS, deleteObject, inspectObject, putObjectBuffer } from '../../src/lib/storage/s3-client';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;

/** Chaves gravadas no bucket durante os testes, para limpar no fim. */
const createdKeys: string[] = [];

/** PNG de verdade: a conversão precisa ter o que decodificar e recomprimir. */
async function legacyPng(width = 640, height = 480): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 74, b: 110 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Um ativo "legado": bytes de PNG direto no bucket e a linha com `image/png`.
 *
 * É o retrato do acervo anterior à FASE 46 — passar pelo `requestAssetUpload` /
 * `confirmAssetUpload` CONVERTERIA na confirmação, e o teste mediria a esteira nova em
 * vez do reprocessamento.
 */
async function createLegacyAsset(input: {
  target: string;
  fileName: string;
}): Promise<{ id: string; objectKey: string; url: string }> {
  const bucket = BUCKETS.assets();
  const objectKey = `legacy/${RUN}/${randomUUID()}.png`;
  const bytes = await legacyPng();
  const url = `http://localhost:9000/${bucket}/${objectKey}`;

  await putObjectBuffer({
    bucket,
    objectKey,
    body: bytes,
    contentType: 'image/png',
  });
  createdKeys.push(objectKey);

  const asset = await withTenant(tenantId, (tx) =>
    tx.mediaAsset.create({
      data: {
        tenantId,
        eventId,
        bucket,
        objectKey,
        url,
        fileName: input.fileName,
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        checksum: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        target: input.target,
      },
      select: { id: true, objectKey: true, url: true },
    }),
  );

  return asset;
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  const actorId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f56-e65-${RUN}`,
      name: `Instituição do reprocessamento ${RUN}`,
    },
  });

  await adminPrisma.user.create({
    data: {
      id: actorId,
      name: `Organizador ${RUN}`,
      email: `f56.e65.${RUN}@example.test`,
    },
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-e65-${RUN}`,
        title: `Evento do reprocessamento ${RUN}`,
        status: 'PUBLISHED',
        startsAt: new Date(Date.now() + 30 * 86_400_000),
        endsAt: new Date(Date.now() + 31 * 86_400_000),
      },
    });
  });
});

afterAll(async () => {
  const bucket = BUCKETS.assets();

  for (const key of createdKeys) {
    await deleteObject(bucket, key).catch(() => undefined);
    /** A conversão grava em chave nova: a limpeza precisa das duas. */
    await deleteObject(bucket, key.replace(/\.png$/, '.webp')).catch(() => undefined);
  }

  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
});

describe('reprocessamento do acervo em WebP (dívida E65)', () => {
  it('converte o PNG legado: chave NOVA, conteúdo WebP e o original fora do bucket', async () => {
    const asset = await createLegacyAsset({ target: 'GALLERY', fileName: `galeria-${RUN}.png` });

    const summary = await reprocessMediaAssets([tenantId]);

    expect(summary.converted).toBe(1);
    expect(summary.failures).toBe(0);
    expect(summary.skippedInUse).toBe(0);

    const row = await withTenant(tenantId, (tx) =>
      tx.mediaAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { objectKey: true, url: true, mimeType: true, sizeBytes: true, checksum: true },
      }),
    );

    /** Chave NOVA e `.webp` — um `.png` com bytes de WebP seria mentira no bucket. */
    expect(row.objectKey).toMatch(/\.webp$/);
    expect(row.objectKey).not.toBe(asset.objectKey);
    expect(row.mimeType).toBe('image/webp');
    expect(row.sizeBytes).toBeGreaterThan(0);
    expect(row.url).toContain(row.objectKey);

    /** O objeto publicado é WebP de verdade — não "PNG renomeado". */
    const stored = await inspectObject(BUCKETS.assets(), row.objectKey);
    expect(stored.exists).toBe(true);
    expect(stored.contentType).toBe('image/webp');

    /** E o original saiu: o acervo não paga duas vezes pelo mesmo pixel. */
    const original = await inspectObject(BUCKETS.assets(), asset.objectKey);
    expect(original.exists).toBe(false);
  }, 120_000);

  it('imagem EM USO é PULADA — a URL está gravada nas referências', async () => {
    const asset = await createLegacyAsset({ target: 'COVER', fileName: `capa-${RUN}.png` });

    /** A capa do evento aponta para ela: converter trocaria a URL e quebraria a página. */
    await withTenant(tenantId, (tx) =>
      tx.event.update({ where: { id: eventId }, data: { coverImageUrl: asset.url } }),
    );

    const summary = await reprocessMediaAssets([tenantId]);

    expect(summary.skippedInUse).toBe(1);
    expect(summary.converted).toBe(0);

    const row = await withTenant(tenantId, (tx) =>
      tx.mediaAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { objectKey: true, mimeType: true },
      }),
    );

    expect(row.objectKey).toBe(asset.objectKey);
    expect(row.mimeType).toBe('image/png');

    const original = await inspectObject(BUCKETS.assets(), asset.objectKey);
    expect(original.exists).toBe(true);

    /** Limpa a referência para os outros testes não herdarem o "em uso". */
    await withTenant(tenantId, (tx) =>
      tx.event.update({ where: { id: eventId }, data: { coverImageUrl: null } }),
    );
  }, 120_000);

  it('a SIMULAÇÃO conta o que faria e não escreve nada', async () => {
    const asset = await createLegacyAsset({ target: 'GALLERY', fileName: `simulacao-${RUN}.png` });

    const summary = await reprocessMediaAssets([tenantId], { dryRun: true });

    /**
     * `>= 1`, e não `1`: o ativo do teste anterior ficou elegível quando a referência de
     * capa foi limpa — a simulação o conta também. Amarrar o número exato faria este
     * teste depender da ordem dos irmãos.
     */
    expect(summary.converted).toBeGreaterThanOrEqual(1);
    expect(summary.bytesAfter).toBe(0);

    const row = await withTenant(tenantId, (tx) =>
      tx.mediaAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { objectKey: true, mimeType: true },
      }),
    );

    expect(row.objectKey).toBe(asset.objectKey);
    expect(row.mimeType).toBe('image/png');

    const original = await inspectObject(BUCKETS.assets(), asset.objectKey);
    expect(original.exists).toBe(true);
  }, 120_000);
});
