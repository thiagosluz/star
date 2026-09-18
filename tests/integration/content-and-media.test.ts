/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — publicação agendada, pré-visualização e cópia de
 *  patrocinador (FASE 23, itens E9, E11 e E13)
 *
 *  Prova o que o domínio puro não alcança:
 *    • a LEITURA pública considera a data agendada (sem agendador, sem job);
 *    • despublicar limpa a data e a página não volta ao ar sozinha;
 *    • a pré-visualização lê o RASCUNHO (e não é a leitura pública);
 *    • copiar patrocinador casa a cota pela chave, nasce oculto, não copia o valor
 *      do contrato e recusa duplicidade.
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
  copySponsorToEvent,
  listSponsorBoard,
  listSponsorCandidates,
  saveSponsor,
  saveSponsorTier,
} from '../../src/lib/admin/sponsor-service';
import { getEventForPreview, getPublicEvent } from '../../src/lib/events/event-repository';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-f23-${RUN}`;
const SECOND_EVENT_SLUG = `evento-f23-b-${RUN}`;

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
      slug: `f23-conteudo-${RUN}`,
      name: `Instituição Conteúdo ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f23-conteudo-outra-${RUN}`,
      name: `Outra Conteúdo ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizador Conteúdo', email: `f23c.${RUN}@exemplo.test` },
  });

  eventId = randomUUID();
  secondEventId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    for (const [id, slug, title] of [
      [eventId, EVENT_SLUG, `Congresso Conteúdo ${RUN}`],
      [secondEventId, SECOND_EVENT_SLUG, `Simpósio Conteúdo ${RUN}`],
    ] as const) {
      await tx.event.create({
        data: {
          id,
          tenantId,
          slug,
          title,
          summary: 'Evento para os testes da FASE 23.',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt: daysFromNow(30),
          endsAt: daysFromNow(32),
          timezone: 'America/Bahia',
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

// ═══════════════════════════════════════════════════════════════════════════════
describe('publicação agendada (E13)', () => {
  it('agendar para o FUTURO deixa a página fora do ar e o editor diz "agendada"', async () => {
    await ensureHomePage({ tenantId, eventId, actorId });
    const block = await addPageBlock({ tenantId, eventId, actorId, type: 'RICH_TEXT' });
    if (block.ok) {
      await updatePageBlock({
        tenantId,
        eventId,
        actorId,
        blockId: block.blockId,
        content: { title: 'Sobre', body: 'CONTEÚDO AGENDADO' },
      });
    }

    const scheduled = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Conteúdo ${RUN}`,
      isPublished: false,
      publishAt: daysFromNow(3),
    });

    expect(scheduled.ok).toBe(true);
    if (scheduled.ok) {
      expect(scheduled.publication).toBe('SCHEDULED');
      expect(scheduled.message).toContain('entra no ar');
    }

    // A leitura pública não devolve a página: a data ainda não chegou.
    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).toBeNull();

    // O editor, sim — e com o estado certo.
    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.publicationState).toBe('SCHEDULED');
    expect(landing?.page?.publishAt).not.toBeNull();
    expect(landing?.page?.isPublished).toBe(false);
  });

  it('a PRÉVIA mostra o rascunho agendado (o que o público ainda não vê)', async () => {
    const preview = await getEventForPreview(tenantId, eventId);

    expect(preview).not.toBeNull();
    expect(preview?.page).not.toBeNull();
    expect(JSON.stringify(preview?.page?.blocks)).toContain('CONTEÚDO AGENDADO');

    // A leitura pública continua sem a página — a prévia é de ADMINISTRAÇÃO.
    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).toBeNull();
  });

  it('data no PASSADO publica imediatamente', async () => {
    const published = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Conteúdo ${RUN}`,
      isPublished: false,
      publishAt: daysFromNow(-1),
    });

    expect(published.ok).toBe(true);
    if (published.ok) expect(published.publication).toBe('PUBLISHED');

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).not.toBeNull();

    const landing = await getLandingForEdit(tenantId, eventId);
    // A data foi limpa: ela já cumpriu o papel.
    expect(landing?.page?.publishAt).toBeNull();
  });

  it('DESPUBLICAR limpa a data e a página NÃO volta ao ar sozinha', async () => {
    /**
     * O defeito que este teste pega: com a data agendada ainda gravada e já passada,
     * a condição de visibilidade (`isPublished || publishAt <= now`) republicaria a
     * página no instante seguinte ao "despublicar".
     */
    const unpublished = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Conteúdo ${RUN}`,
      isPublished: false,
      publishAt: null,
    });

    expect(unpublished.ok).toBe(true);
    if (unpublished.ok) expect(unpublished.publication).toBe('DRAFT');

    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.publishAt).toBeNull();

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).toBeNull();
  });

  it('publicar agora e agendar ao mesmo tempo é recusado', async () => {
    const rejected = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Conteúdo ${RUN}`,
      isPublished: true,
      publishAt: daysFromNow(5),
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('INVALID_INPUT');
      expect(rejected.message).toContain('publicar agora ou agendar');
    }
  });

  it('publicar de novo tira a marca de agendamento', async () => {
    const published = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso Conteúdo ${RUN}`,
      isPublished: true,
    });

    expect(published.ok).toBe(true);

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page?.isPublished).toBe(true);
    expect(publicEvent?.page?.publishAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cópia de patrocinador (E11)', () => {
  let goldTierId: string;
  let goldTierSecondEventId: string;
  let sourceSponsorId: string;

  it('prepara cotas e um patrocinador no evento de origem', async () => {
    const gold = await saveSponsorTier({
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
    expect(gold.ok).toBe(true);
    if (gold.ok) goldTierId = gold.tierId;

    const goldSecond = await saveSponsorTier({
      tenantId,
      eventId: secondEventId,
      actorId,
      key: 'GOLD',
      name: 'Cota Ouro' /* nome diferente, MESMA chave */,
      description: null,
      color: null,
      rank: 10,
      priceCents: 0,
      currency: 'BRL',
      maxSponsors: 0,
      benefits: [],
    });
    expect(goldSecond.ok).toBe(true);
    if (goldSecond.ok) goldTierSecondEventId = goldSecond.tierId;

    const silverSecond = await saveSponsorTier({
      tenantId,
      eventId: secondEventId,
      actorId,
      key: 'SILVER',
      name: 'Prata',
      description: null,
      color: null,
      rank: 20,
      priceCents: 0,
      currency: 'BRL',
      maxSponsors: 0,
      benefits: [],
    });
    expect(silverSecond.ok).toBe(true);

    const sponsor = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: 'Instituto de Tecnologia Aberta',
      description: 'Apoiadora do congresso.',
      websiteUrl: 'https://example.org/ita',
      logoUrl: 'https://cdn.test/ita.png',
      tierId: goldTierId,
      contactName: 'Marina Alves',
      contactEmail: 'marina@example.org',
      contactPhone: '+55 71 99999-0000',
      taxId: '12345678000199',
      contractValueCents: 1_500_000,
      contractStart: daysFromNow(-30),
      contractEnd: daysFromNow(120),
      displayOrder: 0,
      isActive: true,
    });

    expect(sponsor.ok).toBe(true);
    if (sponsor.ok) sourceSponsorId = sponsor.sponsorId;
  });

  it('a lista de candidatos agrupa por nome e marca quem já está no evento', async () => {
    const candidates = await listSponsorCandidates(tenantId, secondEventId);

    const candidate = candidates.find((entry) => entry.name === 'Instituto de Tecnologia Aberta');
    expect(candidate).toBeDefined();
    expect(candidate?.alreadyInEvent).toBe(false);
    expect(candidate?.tierKey).toBe('GOLD');
    expect(candidate?.events.map((event) => event.id)).toContain(eventId);
  });

  it('copia casando a cota pela CHAVE (Ouro → "Cota Ouro") e nasce OCULTO', async () => {
    const copied = await copySponsorToEvent({
      tenantId,
      eventId: secondEventId,
      actorId,
      sourceSponsorId,
    });

    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    expect(copied.tierMatched).toBe(true);

    const board = await listSponsorBoard(tenantId, secondEventId);
    const row = board?.sponsors.find((sponsor) => sponsor.id === copied.sponsorId);

    expect(row?.name).toBe('Instituto de Tecnologia Aberta');
    expect(row?.tierId).toBe(goldTierSecondEventId);
    expect(row?.isActive).toBe(false);
    // O contato e o documento vão junto; o VALOR do contrato, não.
    expect(row?.contactEmail).toBe('marina@example.org');
    expect(row?.taxIdMasked).toBe('12.345.678/****-99');
    expect(row?.contractValueCents).toBeNull();
    // Quem está oculto não aparece na página pública.
    expect(board?.publicCount).toBe(0);
  });

  it('RECUSA copiar duas vezes para o mesmo evento', async () => {
    const again = await copySponsorToEvent({
      tenantId,
      eventId: secondEventId,
      actorId,
      sourceSponsorId,
    });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toContain('já está cadastrado');
  });

  it('avisa quando a cota de origem não existe no destino', async () => {
    /**
     * A cota de Bronze existe no SEGUNDO evento (origem) e não no primeiro
     * (destino) — é o caso em que a cópia entra sem cota, e a tela precisa dizer
     * isso em vez de deixar o organizador descobrir depois.
     */
    const bronze = await saveSponsorTier({
      tenantId,
      eventId: secondEventId,
      actorId,
      key: 'BRONZE',
      name: 'Bronze',
      description: null,
      color: null,
      rank: 30,
      priceCents: 0,
      currency: 'BRL',
      maxSponsors: 0,
      benefits: [],
    });
    expect(bronze.ok).toBe(true);
    if (!bronze.ok) return;

    const created = await saveSponsor({
      tenantId,
      eventId: secondEventId,
      actorId,
      name: 'Editora Bronze',
      description: null,
      websiteUrl: null,
      logoUrl: null,
      tierId: bronze.tierId,
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
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const copied = await copySponsorToEvent({
      tenantId,
      eventId,
      actorId,
      sourceSponsorId: created.sponsorId,
    });

    expect(copied.ok).toBe(true);
    if (copied.ok) {
      expect(copied.tierMatched).toBe(false);

      const board = await listSponsorBoard(tenantId, eventId);
      const row = board?.sponsors.find((sponsor) => sponsor.id === copied.sponsorId);
      expect(row?.tierId).toBeNull();
      expect(row?.isActive).toBe(false);
    }
  });

  it('não enxerga patrocinadores de OUTRA instituição', async () => {
    const candidates = await listSponsorCandidates(otherTenantId, secondEventId);
    expect(candidates).toEqual([]);
  });
});
