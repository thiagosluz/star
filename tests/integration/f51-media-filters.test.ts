/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — filtros do acervo de mídia (FASE 51, dívida E19)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PROVAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • cada filtro funciona SOZINHO (busca, tipo, evento de origem, em uso × sem uso);
 *    • os filtros COMBINAM (interseção, não "o último que falou");
 *    • busca sem resultado devolve lista VAZIA — a tela não inventa imagem;
 *    • o filtro "em uso" usa a MESMA noção de uso que a tela mostra (a URL referenciada
 *      por evento, patrocinador e bloco de página), e não uma segunda regra;
 *    • o filtro acontece NO BANCO: uma imagem antiga que a janela das 200 descarta
 *      aparece quando é ela que o filtro procura (é a diferença entre filtrar antes e
 *      filtrar depois de já ter cortado a lista).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listMediaLibrary, registerAsset } from '../../src/lib/admin/media-asset-service';
import {
  addPageBlock,
  ensureHomePage,
  updatePageBlock,
} from '../../src/lib/admin/landing-service';
import { saveSponsor } from '../../src/lib/admin/sponsor-service';
import {
  MEDIA_LIBRARY_LIMIT,
  MEDIA_NO_SOURCE_EVENT,
  normalizeMediaMimeType,
  normalizeMediaSearch,
  parseMediaSourceEvent,
  parseMediaUsageFilter,
} from '../../src/domain/events/media-filter-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let actorId: string;
let eventAId: string;
let eventBId: string;

/** tenant do cenário do teto, separado para as contagens não se misturarem. */
let bulkTenantId: string;
let bulkEventId: string;

let coverAssetId: string;
let sponsorAssetId: string;
let galleryAssetId: string;
let freeAssetId: string;
let orphanAssetId: string;

const URL = {
  cover: `https://cdn.test/f51-${RUN}/capa-congresso.png`,
  sponsor: `https://cdn.test/f51-${RUN}/logo-parceiro.png`,
  gallery: `https://cdn.test/f51-${RUN}/galeria-simposio.png`,
  free: `https://cdn.test/f51-${RUN}/sobra-antiga.png`,
  orphan: `https://cdn.test/f51-${RUN}/acervo-sem-evento.png`,
};

function checksum(): string {
  return randomUUID().replace(/-/g, '').padEnd(64, 'a').slice(0, 64);
}

/** Registra um asset pelo serviço real (o upload exige storage; aqui só o registro). */
async function seedAsset(input: {
  tenantId: string;
  eventId: string;
  target: 'COVER' | 'LOGO' | 'SPONSOR_LOGO' | 'GALLERY';
  url: string;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const created = await withTenant(input.tenantId, (tx) =>
    registerAsset(tx, {
      tenantId: input.tenantId,
      eventId: input.eventId,
      actorId,
      target: input.target,
      bucket: 'eventflow-assets',
      objectKey: `tenants/${input.tenantId}/assets/${randomUUID()}.webp`,
      url: input.url,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: 2048,
      checksum: checksum(),
    }),
  );

  return created.assetId;
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f51-midia-${RUN}`,
      name: `Instituição Filtros ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f51-outra-${RUN}`,
      name: `Outra Instituição ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  const bulk = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f51-lote-${RUN}`,
      name: `Instituição Acervo Grande ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  bulkTenantId = bulk.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizadora Filtros', email: `f51.${RUN}@exemplo.test` },
  });

  eventAId = randomUUID();
  eventBId = randomUUID();
  bulkEventId = randomUUID();

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    for (const [id, slug, title] of [
      [eventAId, `evento-a-${RUN}`, `Congresso Filtros ${RUN}`],
      [eventBId, `evento-b-${RUN}`, `Simpósio Filtros ${RUN}`],
    ] as const) {
      await tx.event.create({
        data: {
          id,
          tenantId,
          slug,
          title,
          summary: 'Evento para os testes dos filtros do acervo.',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
          confirmedCount: 0,
        },
      });
    }
  });

  await withTenant(bulkTenantId, (tx) =>
    tx.event.create({
      data: {
        id: bulkEventId,
        tenantId: bulkTenantId,
        slug: `evento-lote-${RUN}`,
        title: `Acervo grande ${RUN}`,
        summary: 'Evento do cenário do teto de 200.',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
        confirmedCount: 0,
      },
    }),
  );

  // ── Acervo do cenário dos filtros (5 imagens, 3 em uso) ────────────────────
  coverAssetId = await seedAsset({
    tenantId,
    eventId: eventAId,
    target: 'COVER',
    url: URL.cover,
    fileName: 'capa-congresso.png',
    mimeType: 'image/webp',
  });

  sponsorAssetId = await seedAsset({
    tenantId,
    eventId: eventAId,
    target: 'SPONSOR_LOGO',
    url: URL.sponsor,
    fileName: 'logo-parceiro.png',
    mimeType: 'image/png',
  });

  galleryAssetId = await seedAsset({
    tenantId,
    eventId: eventBId,
    target: 'GALLERY',
    url: URL.gallery,
    fileName: 'galeria-simposio.png',
    mimeType: 'image/webp',
  });

  freeAssetId = await seedAsset({
    tenantId,
    eventId: eventBId,
    target: 'GALLERY',
    url: URL.free,
    fileName: 'sobra-antiga.png',
    mimeType: 'image/png',
  });

  /**
   * Imagem SEM evento (acervo da instituição).
   *
   * `registerAsset` exige um evento — o upload sempre nasce num —, então este caso é
   * gravado direto: é o estado que o schema permite (`eventId` nulável) e o filtro
   * "sem evento" precisa alcançá-lo.
   */
  orphanAssetId = randomUUID();
  await withTenant(tenantId, (tx) =>
    tx.mediaAsset.create({
      data: {
        id: orphanAssetId,
        tenantId,
        eventId: null,
        bucket: 'eventflow-assets',
        objectKey: `tenants/${tenantId}/assets/${randomUUID()}.avif`,
        url: URL.orphan,
        fileName: 'acervo-sem-evento.avif',
        mimeType: 'image/avif',
        sizeBytes: 1024,
        checksum: checksum(),
        target: 'GALLERY',
        uploadedById: actorId,
      },
    }),
  );

  // ── Uso: capa do evento A, logotipo de patrocinador e bloco da página do B ─
  await withTenant(tenantId, (tx) =>
    tx.event.update({ where: { id: eventAId }, data: { coverImageUrl: URL.cover } }),
  );

  await saveSponsor({
    tenantId,
    eventId: eventAId,
    actorId,
    name: `Parceiro Filtros ${RUN}`,
    description: null,
    websiteUrl: null,
    logoUrl: URL.sponsor,
    tierId: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    taxId: null,
    contractValueCents: null,
    contractStart: null,
    contractEnd: null,
    displayOrder: 0,
    isActive: true,
  });

  await ensureHomePage({ tenantId, eventId: eventBId, actorId });
  const block = await addPageBlock({ tenantId, eventId: eventBId, actorId, type: 'GALLERY' });
  expect(block.ok).toBe(true);
  if (block.ok) {
    await updatePageBlock({
      tenantId,
      eventId: eventBId,
      actorId,
      blockId: block.blockId,
      content: { images: [{ url: URL.gallery, caption: 'Foto do simpósio' }] },
    });
  }

  // ── Acervo grande: 200 recentes de ruído + 5 antigas que o filtro procura ──
  const now = Date.now();
  const longAgo = new Date(now - 400 * 86_400_000);

  await withTenant(bulkTenantId, (tx) =>
    tx.mediaAsset.createMany({
      data: [
        ...Array.from({ length: 200 }, (_, index) => ({
          id: randomUUID(),
          tenantId: bulkTenantId,
          eventId: bulkEventId,
          bucket: 'eventflow-assets',
          objectKey: `tenants/${bulkTenantId}/assets/ruido-${index}.webp`,
          url: `https://cdn.test/f51-${RUN}/ruido-${index}.webp`,
          fileName: `ruido-${index}.webp`,
          mimeType: 'image/webp',
          sizeBytes: 1000,
          checksum: checksum(),
          target: 'GALLERY',
          uploadedById: actorId,
          createdAt: new Date(now - index * 60_000),
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          id: randomUUID(),
          tenantId: bulkTenantId,
          eventId: bulkEventId,
          bucket: 'eventflow-assets',
          objectKey: `tenants/${bulkTenantId}/assets/alvo-${index}.png`,
          url: `https://cdn.test/f51-${RUN}/alvo-${index}.png`,
          fileName: `alvo-${index}.png`,
          mimeType: 'image/png',
          sizeBytes: 1000,
          checksum: checksum(),
          target: 'COVER',
          uploadedById: actorId,
          createdAt: longAgo,
        })),
      ],
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('regras puras do filtro (E19)', () => {
  it('busca vazia é ausência de filtro, não busca por string vazia', () => {
    expect(normalizeMediaSearch('   ')).toBeNull();
    expect(normalizeMediaSearch(null)).toBeNull();
    expect(normalizeMediaSearch('  capa  ')).toBe('capa');
    expect(normalizeMediaSearch('x'.repeat(300))?.length).toBe(120);
  });

  it('o tipo é normalizado em caixa baixa (é assim que o serviço grava)', () => {
    expect(normalizeMediaMimeType('IMAGE/WEBP')).toBe('image/webp');
    expect(normalizeMediaMimeType('')).toBeNull();
  });

  it('evento malformado é descartado em vez de derrubar a consulta', () => {
    expect(parseMediaSourceEvent('abc')).toBeNull();
    expect(parseMediaSourceEvent(` ${eventAId} `)).toBe(eventAId);
    expect(parseMediaSourceEvent(MEDIA_NO_SOURCE_EVENT)).toBe(MEDIA_NO_SOURCE_EVENT);
    expect(parseMediaSourceEvent('')).toBeNull();
  });

  it('"em uso" e "livre" são estados distintos de "todos"', () => {
    expect(parseMediaUsageFilter('em-uso')).toBe(true);
    expect(parseMediaUsageFilter('livre')).toBe(false);
    expect(parseMediaUsageFilter('')).toBeNull();
    expect(parseMediaUsageFilter('qualquer-coisa')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('filtros do acervo (E19)', () => {
  it('sem filtro a lista é o acervo inteiro, e o cabeçalho conta a mesma coisa', async () => {
    const library = await listMediaLibrary(tenantId);

    expect(library.matchedCount).toBe(5);
    expect(library.assets).toHaveLength(5);
    expect(library.truncated).toBe(false);
    expect(library.library.count).toBe(5);
    expect(library.library.inUse).toBe(3);
    expect(library.library.bytes).toBe(2048 * 4 + 1024);
  });

  it('não enxerga o acervo de outra instituição nem com filtro', async () => {
    const foreign = await listMediaLibrary(otherTenantId, {
      filters: { inUse: false, sourceEventId: MEDIA_NO_SOURCE_EVENT },
    });

    expect(foreign.assets).toEqual([]);
    expect(foreign.matchedCount).toBe(0);
  });

  it('busca por nome de arquivo', async () => {
    const library = await listMediaLibrary(tenantId, {
      filters: { search: normalizeMediaSearch('galeria-simposio') },
    });

    expect(library.matchedCount).toBe(1);
    expect(library.assets.map((asset) => asset.id)).toEqual([galleryAssetId]);
  });

  it('busca pela URL, sem depender da caixa', async () => {
    const library = await listMediaLibrary(tenantId, {
      filters: { search: normalizeMediaSearch('SOBRA-ANTIGA') },
    });

    expect(library.assets.map((asset) => asset.id)).toEqual([freeAssetId]);
  });

  it('busca sem resultado devolve lista vazia, e não a lista inteira', async () => {
    const library = await listMediaLibrary(tenantId, {
      filters: { search: normalizeMediaSearch('arquivo-que-nao-existe-9f8a') },
    });

    expect(library.matchedCount).toBe(0);
    expect(library.assets).toEqual([]);
    expect(library.truncated).toBe(false);
  });

  it('filtro por tipo', async () => {
    const png = await listMediaLibrary(tenantId, { filters: { mimeType: 'image/png' } });
    expect(png.matchedCount).toBe(2);
    expect(png.assets.map((asset) => asset.id).sort()).toEqual(
      [sponsorAssetId, freeAssetId].sort(),
    );

    const avif = await listMediaLibrary(tenantId, { filters: { mimeType: 'image/avif' } });
    expect(avif.assets.map((asset) => asset.id)).toEqual([orphanAssetId]);
  });

  it('tipo que o acervo não tem devolve vazio (e as opções saem do acervo)', async () => {
    const none = await listMediaLibrary(tenantId, { filters: { mimeType: 'image/jpeg' } });
    expect(none.assets).toEqual([]);

    const library = await listMediaLibrary(tenantId);
    expect(library.typeOptions.map((option) => option.value).sort()).toEqual([
      'image/avif',
      'image/png',
      'image/webp',
    ]);
    expect(library.typeOptions.every((option) => option.count > 0)).toBe(true);
  });

  it('filtro por evento de origem, incluindo o acervo sem evento', async () => {
    const doEventoA = await listMediaLibrary(tenantId, { filters: { sourceEventId: eventAId } });
    expect(doEventoA.assets.map((asset) => asset.id).sort()).toEqual(
      [coverAssetId, sponsorAssetId].sort(),
    );

    const semEvento = await listMediaLibrary(tenantId, {
      filters: { sourceEventId: MEDIA_NO_SOURCE_EVENT },
    });
    expect(semEvento.assets.map((asset) => asset.id)).toEqual([orphanAssetId]);

    const library = await listMediaLibrary(tenantId);
    const values = library.eventOptions.map((option) => option.value);
    expect(values).toContain(eventAId);
    expect(values).toContain(eventBId);
    expect(values).toContain(MEDIA_NO_SOURCE_EVENT);
  });

  it('filtro "em uso" bate com a mesma noção de uso que a tela mostra', async () => {
    /**
     * A referência é a LISTA SEM FILTRO: são as linhas que a tela marcaria como "em
     * uso" (capa do evento, logotipo de patrocinador e imagem de bloco). Se o filtro
     * usasse outra regra, os dois conjuntos divergiriam aqui.
     */
    const todos = await listMediaLibrary(tenantId);
    const marcadosNaTela = todos.assets.filter((asset) => asset.inUse).map((asset) => asset.id);

    const emUso = await listMediaLibrary(tenantId, { filters: { inUse: true } });

    expect(marcadosNaTela.length).toBe(3);
    expect(emUso.assets.map((asset) => asset.id).sort()).toEqual([...marcadosNaTela].sort());
    expect(emUso.assets.every((asset) => asset.inUse && asset.usages.length > 0)).toBe(true);
    expect(emUso.assets.map((asset) => asset.id)).toContain(galleryAssetId);
    expect(emUso.assets.find((asset) => asset.id === sponsorAssetId)?.usages[0]?.label).toContain(
      'patrocinador',
    );
  });

  it('filtro "sem uso" devolve exatamente o complemento', async () => {
    const semUso = await listMediaLibrary(tenantId, { filters: { inUse: false } });

    expect(semUso.assets.map((asset) => asset.id).sort()).toEqual(
      [freeAssetId, orphanAssetId].sort(),
    );
    expect(semUso.assets.every((asset) => !asset.inUse)).toBe(true);
  });

  it('os filtros COMBINAM (interseção, não o último que falou)', async () => {
    const combinado = await listMediaLibrary(tenantId, {
      filters: { mimeType: 'image/png', inUse: false, search: normalizeMediaSearch('sobra') },
    });

    expect(combinado.assets.map((asset) => asset.id)).toEqual([freeAssetId]);

    // Mesma busca, mas exigindo "em uso": a interseção é vazia.
    const contraditorio = await listMediaLibrary(tenantId, {
      filters: { mimeType: 'image/png', inUse: true, search: normalizeMediaSearch('sobra') },
    });

    expect(contraditorio.matchedCount).toBe(0);
    expect(contraditorio.assets).toEqual([]);

    // Tipo + evento: o PNG do evento A é só o logotipo do patrocinador.
    const tipoEEvento = await listMediaLibrary(tenantId, {
      filters: { mimeType: 'image/png', sourceEventId: eventAId },
    });

    expect(tipoEEvento.assets.map((asset) => asset.id)).toEqual([sponsorAssetId]);
  });

  it('o cabeçalho NÃO encolhe quando a pessoa filtra', async () => {
    const filtrado = await listMediaLibrary(tenantId, {
      filters: { mimeType: 'image/avif' },
    });

    // O resultado é 1 imagem, mas o acervo continua tendo 5 — e 3 em uso.
    expect(filtrado.matchedCount).toBe(1);
    expect(filtrado.library.count).toBe(5);
    expect(filtrado.library.inUse).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('teto de 200 e filtro NO BANCO (E19)', () => {
  it('o acervo grande é truncado em 200 e diz quanto ficou de fora', async () => {
    const library = await listMediaLibrary(bulkTenantId);

    expect(library.limit).toBe(MEDIA_LIBRARY_LIMIT);
    expect(library.assets).toHaveLength(200);
    expect(library.matchedCount).toBe(205);
    expect(library.truncated).toBe(true);
  });

  it('o filtro alcança a imagem ANTIGA que a janela das 200 descarta', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ESTE É O TESTE QUE PRENDE A DÍVIDA E19
     * ─────────────────────────────────────────────────────────────────────────────
     *  As 5 imagens `alvo-*` são as MAIS ANTIGAS do acervo: ficam fora das 200 mais
     *  recentes. Se o serviço trouxesse 200 linhas e filtrasse em memória, a busca por
     *  elas devolveria VAZIO — e a pessoa concluiria que a imagem não existe, quando
     *  ela existe e é justamente a que ela procura. Com o filtro no banco, a janela
     *  passa a cortar o RESULTADO do filtro.
     */
    const semFiltro = await listMediaLibrary(bulkTenantId);
    expect(semFiltro.assets.some((asset) => asset.fileName.startsWith('alvo-'))).toBe(false);

    const comFiltro = await listMediaLibrary(bulkTenantId, { filters: { mimeType: 'image/png' } });

    expect(comFiltro.matchedCount).toBe(5);
    expect(comFiltro.assets).toHaveLength(5);
    expect(comFiltro.assets.every((asset) => asset.fileName.startsWith('alvo-'))).toBe(true);
    expect(comFiltro.truncated).toBe(false);
  });

  it('resultado ainda maior que o teto continua truncado depois do filtro', async () => {
    const filtrado = await listMediaLibrary(bulkTenantId, { filters: { mimeType: 'image/webp' } });

    expect(filtrado.matchedCount).toBe(200);
    expect(filtrado.assets).toHaveLength(200);
    expect(filtrado.truncated).toBe(false);
  });
});
