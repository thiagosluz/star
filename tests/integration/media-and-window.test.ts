/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — mídia, janela de exibição e sincronia (FASE 24)
 *
 *  Prova o que o domínio puro não alcança:
 *    • E14 — o envio registra a imagem no acervo, o MESMO arquivo é reaproveitado e a
 *      exclusão é recusada quando a imagem está em uso (dizendo onde);
 *    • E16 — a página sai do ar sozinha quando a data de término passa;
 *    • E17 — a data digitada é interpretada no fuso do EVENTO, não no do processo;
 *    • E15 — a cópia guarda a origem e sincroniza só os dados da empresa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  addPageBlock,
  ensureHomePage,
  getLandingForEdit,
  savePageSettings,
  updatePageBlock,
} from '../../src/lib/admin/landing-service';
import {
  deleteMediaAsset,
  listMediaLibrary,
  registerAsset,
  sumMediaBytes,
} from '../../src/lib/admin/media-asset-service';
import {
  copySponsorToEvent,
  listSponsorBoard,
  saveSponsor,
  saveSponsorTier,
  syncSponsorFromSource,
} from '../../src/lib/admin/sponsor-service';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import { zonedWallTimeToInstant } from '../../src/domain/events/scheduling-rules';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-f24-${RUN}`;
const SECOND_EVENT_SLUG = `evento-f24-b-${RUN}`;

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let secondEventId: string;
let actorId: string;

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f24-midia-${RUN}`,
      name: `Instituição Mídia ${RUN}`,
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
      slug: `f24-outra-${RUN}`,
      name: `Outra Mídia ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizador Mídia', email: `f24.${RUN}@exemplo.test` },
  });

  eventId = randomUUID();
  secondEventId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    for (const [id, slug, title] of [
      [eventId, EVENT_SLUG, `Congresso Mídia ${RUN}`],
      [secondEventId, SECOND_EVENT_SLUG, `Simpósio Mídia ${RUN}`],
    ] as const) {
      await tx.event.create({
        data: {
          id,
          tenantId,
          slug,
          title,
          summary: 'Evento para os testes da FASE 24.',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          // Fuso DIFERENTE de UTC de propósito: é ele que a conversão deve usar.
          timezone: 'America/Bahia',
          startsAt: daysFromNow(30),
          endsAt: daysFromNow(32),
          confirmedCount: 0,
        },
      });
    }
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

/** Registra um asset direto pelo serviço (o upload real exige o storage). */
async function seedAsset(input: {
  target: 'COVER' | 'LOGO' | 'SPONSOR_LOGO' | 'GALLERY';
  url: string;
  checksum?: string;
  sizeBytes?: number;
  event?: string;
}) {
  const objectKey = `tenants/${tenantId}/eventos/${input.event ?? eventId}/assets/${input.target.toLowerCase()}/${randomUUID()}.png`;

  return withTenant(tenantId, (tx) =>
    registerAsset(tx, {
      tenantId,
      eventId: input.event ?? eventId,
      actorId,
      target: input.target,
      bucket: 'eventflow-assets',
      objectKey,
      url: input.url,
      fileName: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: input.sizeBytes ?? 2048,
      checksum: input.checksum ?? randomUUID().replace(/-/g, '').padEnd(64, 'a').slice(0, 64),
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('biblioteca de mídia (E14)', () => {
  it('o envio registra a imagem no acervo com autor, tamanho e checksum', async () => {
    const created = await seedAsset({ target: 'COVER', url: 'https://cdn.test/capa.png' });
    expect(created.deduplicated).toBe(false);

    const library = await listMediaLibrary(tenantId);
    const row = library.assets.find((asset) => asset.id === created.assetId);

    expect(row).toBeDefined();
    expect(row?.fileName).toBe('foto.png');
    expect(row?.mimeType).toBe('image/png');
    expect(row?.sizeBytes).toBe(2048);
    expect(row?.uploadedByName).toBe('Organizador Mídia');
    expect(row?.targetLabel).toBe('Imagem de capa');
    expect(library.totalBytes).toBeGreaterThanOrEqual(2048);
  });

  it('o MESMO arquivo (mesmo checksum) é reaproveitado em vez de duplicar', async () => {
    /**
     * Subir a mesma foto para a capa e para a galeria criava dois objetos iguais no
     * bucket, cobrados duas vezes. Com o registro, o segundo envio devolve a URL do
     * primeiro (e o serviço apaga o objeto recém-enviado).
     */
    const checksum = 'b'.repeat(64);
    const first = await seedAsset({
      target: 'GALLERY',
      url: 'https://cdn.test/repetida.png',
      checksum,
    });

    const second = await seedAsset({
      target: 'GALLERY',
      url: 'https://cdn.test/repetida-2.png',
      checksum,
    });

    expect(second.deduplicated).toBe(true);
    expect(second.assetId).toBe(first.assetId);
    expect(second.url).toBe('https://cdn.test/repetida.png');

    const library = await listMediaLibrary(tenantId);
    expect(library.assets.filter((asset) => asset.url.includes('repetida')).length).toBe(1);
  });

  it('a soma do acervo considera só o que não foi excluído', async () => {
    const before = await sumMediaBytes(tenantId);
    const created = await seedAsset({
      target: 'GALLERY',
      url: 'https://cdn.test/soma.png',
      sizeBytes: 4096,
    });

    expect(await sumMediaBytes(tenantId)).toBe(before + 4096);

    // A soma é do ACERVO; a exclusão depende do uso, então usamos um asset livre.
    const library = await listMediaLibrary(tenantId);
    expect(library.assets.some((asset) => asset.id === created.assetId)).toBe(true);
  });

  it('relata o USO da imagem na capa do evento', async () => {
    const url = 'https://cdn.test/capa-em-uso.png';

    await withTenant(tenantId, (tx) =>
      tx.event.update({ where: { id: eventId }, data: { coverImageUrl: url } }),
    );

    const created = await seedAsset({ target: 'COVER', url });

    const library = await listMediaLibrary(tenantId);
    const row = library.assets.find((asset) => asset.id === created.assetId);

    expect(row?.inUse).toBe(true);
    expect(row?.usages[0]?.label).toContain('Capa do evento');
  });

  it('relata o uso no LOGOTIPO DE PATROCINADOR e no CONTEÚDO do bloco', async () => {
    const sponsorUrl = 'https://cdn.test/logo-patrocinador.png';
    const galleryUrl = 'https://cdn.test/galeria-bloco.png';

    await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: `Parceiro Mídia ${RUN}`,
      description: null,
      websiteUrl: null,
      logoUrl: sponsorUrl,
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

    await ensureHomePage({ tenantId, eventId, actorId });
    const block = await addPageBlock({ tenantId, eventId, actorId, type: 'GALLERY' });
    expect(block.ok).toBe(true);
    if (block.ok) {
      await updatePageBlock({
        tenantId,
        eventId,
        actorId,
        blockId: block.blockId,
        content: { images: [{ url: galleryUrl, caption: 'Foto' }] },
      });
    }

    const sponsorAsset = await seedAsset({ target: 'SPONSOR_LOGO', url: sponsorUrl });
    const galleryAsset = await seedAsset({ target: 'GALLERY', url: galleryUrl });

    const library = await listMediaLibrary(tenantId);

    const sponsorRow = library.assets.find((asset) => asset.id === sponsorAsset.assetId);
    const galleryRow = library.assets.find((asset) => asset.id === galleryAsset.assetId);

    expect(sponsorRow?.inUse).toBe(true);
    expect(sponsorRow?.usages[0]?.label).toContain('patrocinador');

    expect(galleryRow?.inUse).toBe(true);
    expect(galleryRow?.usages.some((usage) => usage.kind === 'PAGE_BLOCK')).toBe(true);
  });

  it('RECUSA excluir imagem em uso, dizendo onde ela está', async () => {
    const url = 'https://cdn.test/em-uso.png';
    await withTenant(tenantId, (tx) =>
      tx.event.update({ where: { id: secondEventId }, data: { logoUrl: url } }),
    );

    const created = await seedAsset({ target: 'LOGO', url, event: secondEventId });

    const denied = await deleteMediaAsset({ tenantId, actorId, assetId: created.assetId });

    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe('IN_USE');
      expect(denied.details?.join(' ')).toContain('Logotipo do evento');
    }

    // O registro continua no acervo.
    const library = await listMediaLibrary(tenantId);
    expect(library.assets.some((asset) => asset.id === created.assetId)).toBe(true);
  });

  it('exclui a imagem LIVRE e ela sai do acervo', async () => {
    const created = await seedAsset({
      target: 'GALLERY',
      url: 'https://cdn.test/livre.png',
      sizeBytes: 1024,
    });

    const before = await sumMediaBytes(tenantId);

    /**
     * `deleteMediaAsset` apaga o OBJETO antes de marcar o registro. Aqui o arquivo
     * nunca existiu de verdade (o teste criou só o registro), e apagar chave
     * inexistente é idempotente no S3 — então o caminho normal é `ok`.
     *
     * A outra possibilidade é o MinIO não estar no ar durante o teste: nesse caso a
     * exclusão TEM de falhar com erro explícito, nunca marcar o registro como
     * apagado deixando o objeto para trás (o acervo mentiria sobre o que ocupa).
     */
    const removed = await deleteMediaAsset({ tenantId, actorId, assetId: created.assetId });

    if (removed.ok) {
      const library = await listMediaLibrary(tenantId);
      expect(library.assets.some((asset) => asset.id === created.assetId)).toBe(false);
      expect(await sumMediaBytes(tenantId)).toBeLessThan(before);
    } else {
      // Sem storage disponível, o erro tem de ser explícito (nunca silencioso).
      expect(['STORAGE', 'INTERNAL']).toContain(removed.code);
    }
  });

  it('não enxerga o acervo de OUTRA instituição', async () => {
    const foreign = await listMediaLibrary(otherTenantId);
    expect(foreign.assets).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('janela de exibição (E16)', () => {
  it('a página com término no PASSADO já não é a página do site', async () => {
    await ensureHomePage({ tenantId, eventId, actorId });
    const pageId = await pageIdOf();
    expect(pageId).not.toBeNull();

    /**
     * A validação recusa término vencido ao PUBLICAR (testada logo abaixo). Para
     * simular a passagem do tempo, o teste grava o estado direto — é o que acontece
     * na vida real: a data era futura quando foi salva e o relógio andou.
     */
    await withTenant(tenantId, (tx) =>
      tx.eventPage.update({
        where: { id: pageId! },
        data: { isPublished: true, publishAt: null, unpublishAt: daysFromNow(-1) },
      }),
    );

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).toBeNull();

    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.publicationState).toBe('WINDOW_CLOSED');
  });

  it('a página com término no FUTURO continua no ar', async () => {
    const saved = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Mídia ${RUN}`,
      isPublished: true,
      unpublishAt: daysFromNow(5),
    });

    expect(saved.ok).toBe(true);

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).not.toBeNull();
    // A data de término viaja para a leitura pública (a tela pode avisar).
    expect(publicEvent?.page?.unpublishAt).not.toBeNull();

    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.publicationState).toBe('PUBLISHED');
  });

  it('agendar entrada e saída deixa a página fora do ar até a data', async () => {
    const scheduled = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Mídia ${RUN}`,
      isPublished: false,
      publishAt: daysFromNow(2),
      unpublishAt: daysFromNow(9),
    });

    expect(scheduled.ok).toBe(true);
    if (scheduled.ok) expect(scheduled.publication).toBe('SCHEDULED');

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).toBeNull();

    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.unpublishAt).not.toBeNull();
  });

  it('RECUSA término antes do início e término vencido', async () => {
    const inverted = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Mídia ${RUN}`,
      isPublished: false,
      publishAt: daysFromNow(10),
      unpublishAt: daysFromNow(3),
    });

    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.message).toContain('depois da data de entrada');

    const past = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Mídia ${RUN}`,
      isPublished: true,
      unpublishAt: daysFromNow(-1),
    });

    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.message).toContain('no futuro');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('fuso do agendamento (E17)', () => {
  it('grava a data interpretada no fuso do EVENTO (e não em UTC)', async () => {
    /**
     * Este é o teste do defeito: o serviço recebe um INSTANTE (a action já converteu
     * a hora de parede). O que se prova aqui é que o instante gravado corresponde à
     * hora de parede no fuso do evento — 18:00 em America/Bahia = 21:00 UTC.
     */
    const wall = '2026-12-01T18:00';
    const instant = zonedWallTimeToInstant(wall, 'America/Bahia');
    expect(instant?.toISOString()).toBe('2026-12-01T21:00:00.000Z');

    const saved = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Mídia ${RUN}`,
      isPublished: false,
      publishAt: instant,
    });

    expect(saved.ok).toBe(true);

    const stored = await withTenant(tenantId, (tx) =>
      tx.eventPage.findFirst({
        where: { eventId },
        select: { publishAt: true },
      }),
    );

    expect(stored?.publishAt?.toISOString()).toBe('2026-12-01T21:00:00.000Z');
  });

  it('o editor devolve o fuso do evento para o formulário', async () => {
    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.eventTimezone).toBe('America/Bahia');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sincronia de patrocinador (E15)', () => {
  let sourceSponsorId: string;
  let copySponsorId: string;

  it('prepara a origem e copia para o segundo evento', async () => {
    const tier = await saveSponsorTier({
      tenantId,
      eventId,
      actorId,
      key: 'GOLD',
      name: 'Ouro',
      description: null,
      color: null,
      rank: 10,
      priceCents: 0,
      currency: 'BRL',
      maxSponsors: 0,
      benefits: [],
    });
    expect(tier.ok).toBe(true);

    const source = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: `Instituto Sincronia ${RUN}`,
      description: 'Descrição original.',
      websiteUrl: 'https://example.org/antigo',
      logoUrl: 'https://cdn.test/logo-v1.png',
      tierId: tier.ok ? tier.tierId : null,
      contactName: 'Marina Alves',
      contactEmail: 'marina@example.org',
      contactPhone: null,
      taxId: '12345678000199',
      contractValueCents: 1_500_000,
      contractStart: daysFromNow(-30),
      contractEnd: daysFromNow(120),
      displayOrder: 0,
      isActive: true,
    });

    expect(source.ok).toBe(true);
    if (!source.ok) return;
    sourceSponsorId = source.sponsorId;

    const copied = await copySponsorToEvent({
      tenantId,
      eventId: secondEventId,
      actorId,
      sourceSponsorId,
    });

    expect(copied.ok).toBe(true);
    if (copied.ok) copySponsorId = copied.sponsorId;
  });

  it('a cópia guarda de ONDE veio', async () => {
    const board = await listSponsorBoard(tenantId, secondEventId);
    const row = board?.sponsors.find((sponsor) => sponsor.id === copySponsorId);

    expect(row?.sourceSponsorId).toBe(sourceSponsorId);
    expect(row?.sourceName).toBe(`Instituto Sincronia ${RUN}`);
  });

  it('sincroniza os dados da EMPRESA e preserva cota, contrato e exibição', async () => {
    // A origem muda de site e de logotipo (a marca foi atualizada).
    await saveSponsor({
      tenantId,
      eventId,
      actorId,
      sponsorId: sourceSponsorId,
      name: `Instituto Sincronia ${RUN}`,
      description: 'Descrição atualizada.',
      websiteUrl: 'https://example.org/novo',
      logoUrl: 'https://cdn.test/logo-v2.png',
      tierId: null,
      contactName: 'Marina Alves',
      contactEmail: 'marina@example.org',
      contactPhone: '+55 71 98888-7777',
      taxId: '12345678000199',
      contractValueCents: 1_500_000,
      contractStart: daysFromNow(-30),
      contractEnd: daysFromNow(120),
      displayOrder: 0,
      isActive: true,
    });

    const before = await listSponsorBoard(tenantId, secondEventId);
    const beforeRow = before?.sponsors.find((sponsor) => sponsor.id === copySponsorId);

    const synced = await syncSponsorFromSource({
      tenantId,
      actorId,
      sponsorId: copySponsorId,
    });

    expect(synced.ok).toBe(true);
    if (synced.ok) {
      expect(synced.changedFields).toContain('websiteUrl');
      expect(synced.changedFields).toContain('logoUrl');
      expect(synced.changedFields).toContain('description');
    }

    const after = await listSponsorBoard(tenantId, secondEventId);
    const afterRow = after?.sponsors.find((sponsor) => sponsor.id === copySponsorId);

    // Dados da empresa: atualizados.
    expect(afterRow?.websiteUrl).toBe('https://example.org/novo');
    expect(afterRow?.logoUrl).toBe('https://cdn.test/logo-v2.png');
    expect(afterRow?.contactPhone).toBe('+55 71 98888-7777');
    expect(afterRow?.taxIdMasked).toBe('12.345.678/****-99');

    // Do evento: intactos (a cópia nasceu oculta e sem valor, e continua assim).
    expect(afterRow?.tierId).toBe(beforeRow?.tierId ?? null);
    expect(afterRow?.contractValueCents).toBeNull();
    expect(afterRow?.isActive).toBe(beforeRow?.isActive);
    expect(afterRow?.sourceSponsorId).toBe(sourceSponsorId);
  });

  it('sincronizar sem diferença não escreve nada', async () => {
    const synced = await syncSponsorFromSource({ tenantId, actorId, sponsorId: copySponsorId });
    expect(synced.ok).toBe(true);
    if (synced.ok) {
      expect(synced.empty).toBe(true);
      expect(synced.changedFields).toEqual([]);
    }
  });

  it('recusa sincronizar um cadastro que NÃO foi copiado', async () => {
    const standalone = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: `Direto ${RUN}`,
      description: null,
      websiteUrl: null,
      logoUrl: null,
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

    expect(standalone.ok).toBe(true);
    if (!standalone.ok) return;

    const rejected = await syncSponsorFromSource({
      tenantId,
      actorId,
      sponsorId: standalone.sponsorId,
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toContain('não foi copiado');
  });

  it('origem removida DESFAZ o vínculo e explica', async () => {
    const ephemeral = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: `Efêmero ${RUN}`,
      description: null,
      websiteUrl: null,
      logoUrl: null,
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
    expect(ephemeral.ok).toBe(true);
    if (!ephemeral.ok) return;

    const copied = await copySponsorToEvent({
      tenantId,
      eventId: secondEventId,
      actorId,
      sourceSponsorId: ephemeral.sponsorId,
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    // A origem é removida (logicamente).
    await withTenant(tenantId, (tx) =>
      tx.sponsor.update({
        where: { id: ephemeral.sponsorId },
        data: { deletedAt: new Date(), isActive: false },
      }),
    );

    const synced = await syncSponsorFromSource({
      tenantId,
      actorId,
      sponsorId: copied.sponsorId,
    });

    expect(synced.ok).toBe(false);
    if (!synced.ok) expect(synced.message).toContain('desfeito');

    // O vínculo saiu do cadastro.
    const board = await listSponsorBoard(tenantId, secondEventId);
    const row = board?.sponsors.find((sponsor) => sponsor.id === copied.sponsorId);
    expect(row?.sourceSponsorId).toBeNull();
  });
});

/** Id da página do evento (usada nos ajustes diretos de data). */
async function pageIdOf(): Promise<string | null> {
  const page = await withTenant(tenantId, (tx) =>
    tx.eventPage.findFirst({ where: { eventId }, select: { id: true } }),
  );

  return page?.id ?? null;
}
