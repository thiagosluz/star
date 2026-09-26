/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — WebP como formato de armazenamento (FASE 46)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O AMBIENTE REAL PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O teste unitário prova que a CONVERSÃO produz WebP. Aqui se prova o percurso
 *  inteiro, com o storage de verdade:
 *
 *    • o objeto que fica no bucket é `.webp`, com `Content-Type: image/webp`;
 *    • o objeto ENVIADO é APAGADO (não fica lixo pago servindo o mesmo pixel);
 *    • o acervo e a capa do evento apontam para o objeto NOVO;
 *    • a quota mede o que foi GRAVADO, e não o que foi enviado;
 *    • um arquivo que não é imagem — mesmo com `image/png` declarado e checksum
 *      correto — é RECUSADO, e o objeto é removido. Antes desta fase, o conteúdo
 *      era confiado pelo `Content-Type` assinado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { confirmAssetUpload, requestAssetUpload } from '../../src/lib/admin/asset-service';
import { listMediaLibrary, sumMediaBytes } from '../../src/lib/admin/media-asset-service';
import { inspectObject } from '../../src/lib/storage/s3-client';
import { storageUsage } from '../../src/lib/storage/storage-quota';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let actorId: string;

/** PNG de verdade: 900×600, para a conversão ter o que reduzir e recomprimir. */
async function realPng(width = 900, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

async function sha256Hex(bytes: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f46-webp-${RUN}`,
      name: `Instituição WebP ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizador WebP', email: `f46.${RUN}@exemplo.test` },
  });

  eventId = randomUUID();
  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f46-${RUN}`,
        title: `Congresso WebP ${RUN}`,
        summary: 'Evento para os testes da FASE 46.',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date(Date.now() + 30 * 86_400_000),
        endsAt: new Date(Date.now() + 32 * 86_400_000),
        confirmedCount: 0,
      },
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

/** Faz o percurso REAL: assina, envia para o bucket e confirma. */
async function uploadAsset(input: {
  target: 'COVER' | 'GALLERY' | 'LOGO';
  fileName: string;
  body: Buffer;
  declaredMime: string;
  /** Bytes que o CLIENTE declara para a validação — mentir aqui é o ataque testado. */
  declaredMagicBytes?: readonly number[];
}) {
  const checksum = await sha256Hex(input.body);

  const ticket = await requestAssetUpload({
    tenantId,
    eventId,
    target: input.target,
    fileName: input.fileName,
    mimeType: input.declaredMime,
    sizeBytes: input.body.length,
    magicBytes: input.declaredMagicBytes ?? [...input.body.subarray(0, 16)],
  });

  expect(ticket.ok, ticket.ok ? 'ok' : ticket.message).toBe(true);
  if (!ticket.ok) throw new Error(ticket.message);

  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.requiredHeaders,
    body: new Uint8Array(input.body),
  });
  expect(put.ok, `PUT falhou: HTTP ${put.status}`).toBe(true);

  const confirmed = await confirmAssetUpload({
    tenantId,
    eventId,
    actorId,
    target: input.target,
    objectKey: ticket.objectKey,
    bucket: ticket.bucket,
    fileName: input.fileName,
    mimeType: ticket.mimeType,
    sizeBytes: input.body.length,
    checksum,
  });

  return { ticket, confirmed };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('envio de imagem guarda WebP (FASE 46)', () => {
  it('o PNG enviado vira .webp no bucket, e o objeto original é APAGADO', async () => {
    const png = await realPng();
    const { ticket, confirmed } = await uploadAsset({
      target: 'GALLERY',
      fileName: 'galeria-f46.png',
      body: png,
      declaredMime: 'image/png',
    });

    expect(confirmed.ok, confirmed.ok ? 'ok' : confirmed.message).toBe(true);
    if (!confirmed.ok) return;

    // A chave final troca só a extensão: o nome enviado continua legível no acervo.
    expect(confirmed.objectKey).toMatch(/\.webp$/);
    expect(confirmed.objectKey.startsWith(ticket.objectKey.replace(/\.png$/, ''))).toBe(true);
    expect(confirmed.url).toMatch(/\.webp$/);

    // O que está gravado é WebP, e MENOR que o original.
    const stored = await inspectObject(ticket.bucket, confirmed.objectKey);
    expect(stored.exists).toBe(true);
    expect(stored.contentType).toBe('image/webp');
    expect(confirmed.sizeBytes).toBe(stored.sizeBytes);
    expect(confirmed.sizeBytes).toBeLessThan(png.length);
    expect(confirmed.sourceBytes).toBe(png.length);
    expect(confirmed.sourceMime).toBe('image/png');

    // O objeto enviado NÃO existe mais: nada de dois objetos para o mesmo pixel.
    const original = await inspectObject(ticket.bucket, ticket.objectKey);
    expect(original.exists).toBe(false);
  });

  it('o acervo guarda o WebP — tipo, tamanho e URL do objeto gravado', async () => {
    const png = await realPng(700, 500);
    const { confirmed } = await uploadAsset({
      target: 'GALLERY',
      fileName: 'acervo-f46.png',
      body: png,
      declaredMime: 'image/png',
    });

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    const library = await listMediaLibrary(tenantId);
    const row = library.assets.find((asset) => asset.url === confirmed.url);

    expect(row).toBeDefined();
    expect(row?.mimeType).toBe('image/webp');
    expect(row?.sizeBytes).toBe(confirmed.sizeBytes);
    // O nome do arquivo é o que a pessoa escolheu; o TIPO é o que ficou guardado.
    expect(row?.fileName).toBe('acervo-f46.png');

    // A quota mede o que a instituição guarda, e não o que foi enviado.
    const measured = await sumMediaBytes(tenantId);
    const usage = await storageUsage(tenantId);
    expect(measured).toBeGreaterThanOrEqual(confirmed.sizeBytes);
    expect(usage.totalBytes).toBeGreaterThanOrEqual(measured);
  }, 60_000);

  it('a capa do evento aponta para o WebP gravado', async () => {
    const { confirmed } = await uploadAsset({
      target: 'COVER',
      fileName: 'capa-f46.png',
      body: await realPng(1600, 900),
      declaredMime: 'image/png',
    });

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    const event = await withTenant(tenantId, (tx) =>
      tx.event.findUniqueOrThrow({
        where: { id: eventId },
        select: { coverImageUrl: true },
      }),
    );

    expect(event.coverImageUrl).toBe(confirmed.url);
    expect(event.coverImageUrl).toMatch(/\.webp$/);

    // A trilha guarda a troca da coluna (é ela que responde "quem trocou a capa").
    const trail = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId, entityType: 'event', entityId: eventId, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
        select: { changes: true },
      }),
    );

    expect(JSON.stringify(trail?.changes ?? {})).toContain('.webp');
  }, 60_000);

  it('arquivo que NÃO é imagem é recusado na CONFIRMAÇÃO — mesmo assinado como image/png', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PORTA QUE A CONVERSÃO FECHOU
     * ─────────────────────────────────────────────────────────────────────────────
     *  A URL assinada trava chave, tamanho e validade — não o CONTEÚDO. E a primeira
     *  validação olha os bytes que o CLIENTE DECLARA, não os que ele envia.
     *
     *  O ataque é este: o cliente manda os 16 primeiros bytes de um PNG legítimo (a
     *  validação passa), recebe a URL assinada e grava HTML nela, com o checksum
     *  calculado sobre o HTML — então a conferência de integridade também passa, e o
     *  `Content-Type` do objeto é o `image/png` que a assinatura mandou.
     *
     *  Até a FASE 46 o arquivo era ACEITO e servido publicamente pelo bucket. Agora a
     *  confirmação DECODIFICA o objeto para virar WebP — e o que não decodifica não é
     *  imagem. É a única checagem do sistema que olha o conteúdo de verdade.
     */
    const honestPng = await realPng(64, 64);
    const hostile = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

    const { ticket, confirmed } = await uploadAsset({
      target: 'GALLERY',
      fileName: 'inocente.png',
      body: hostile,
      declaredMime: 'image/png',
      declaredMagicBytes: [...honestPng.subarray(0, 16)],
    });

    // O pedido PASSA: quem decide ali são os bytes que o cliente declarou.
    expect(ticket.ok).toBe(true);
    expect(ticket.ok && ticket.mimeType).toBe('image/png');

    // E a confirmação recusa, com o motivo escrito.
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.code).toBe('INVALID_INPUT');
      expect(confirmed.message).toMatch(/não pôde ser lido como imagem/i);
    }

    // O objeto hostil NÃO fica no bucket esperando alguém servir — nem com a
    // extensão `.webp` que a conversão teria criado.
    const orphan = await inspectObject(ticket.bucket, ticket.objectKey);
    expect(orphan.exists).toBe(false);
    const wouldBeWebp = await inspectObject(
      ticket.bucket,
      ticket.objectKey.replace(/\.png$/, '.webp'),
    );
    expect(wouldBeWebp.exists).toBe(false);
  }, 60_000);

  it('a conversão é determinística: o mesmo arquivo devolve o mesmo objeto', async () => {
    /**
     * Dois envios do MESMO arquivo produzem bytes WebP idênticos, então o acervo
     * reaproveita o registro e apaga o objeto recém-gravado — o ganho da biblioteca
     * de mídia continua valendo depois da conversão.
     */
    const png = await realPng(420, 260);

    const first = await uploadAsset({
      target: 'LOGO',
      fileName: 'marca-f46.png',
      body: png,
      declaredMime: 'image/png',
    });
    const second = await uploadAsset({
      target: 'LOGO',
      fileName: 'marca-f46.png',
      body: png,
      declaredMime: 'image/png',
    });

    expect(first.confirmed.ok && second.confirmed.ok).toBe(true);
    if (!first.confirmed.ok || !second.confirmed.ok) return;

    // Mesma URL: o segundo envio devolveu o registro do primeiro.
    expect(second.confirmed.url).toBe(first.confirmed.url);

    const library = await listMediaLibrary(tenantId);
    const rows = library.assets.filter((asset) => asset.url === first.confirmed.url);
    expect(rows).toHaveLength(1);
  }, 60_000);
});
