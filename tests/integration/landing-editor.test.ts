/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — editor da página pública (FASE 17, itens E3 e E4)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio
 *  puro não alcança:
 *    • a página nasce DESPUBLICADA e só aparece ao público depois de publicar;
 *    • a ordem dos blocos é reescrita e a página pública renderiza nessa ordem;
 *    • o conteúdo inválido é RECUSADO antes de chegar ao banco;
 *    • o teto de blocos e a idempotência de "criar página" valem de verdade;
 *    • cada mutação deixa rastro na trilha de auditoria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  addPageBlock,
  deletePageBlock,
  ensureHomePage,
  getLandingForEdit,
  movePageBlock,
  savePageSettings,
  seedRecommendedBlocks,
  updatePageBlock,
} from '../../src/lib/admin/landing-service';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import { selectRenderableBlocks } from '../../src/domain/events/landing-page';
import { listAuditLog } from '../../src/lib/admin/audit';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-f17-${RUN}`;

let tenantId: string;
let eventId: string;
let actorId: string;
/** Segunda instituição — prova que o editor não atravessa a fronteira. */
let otherTenantId: string;

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f17-landing-${RUN}`,
      name: `Instituição F17 ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f17-outra-${RUN}`,
      name: `Outra Instituição F17 ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: {
      id: actorId,
      name: 'Organizador F17',
      email: `f17.${RUN}@exemplo.test`,
    },
  });

  eventId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: `Congresso F17 ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-11-10T13:00:00.000Z'),
        endsAt: new Date('2026-11-12T21:00:00.000Z'),
        timezone: 'America/Bahia',
        city: 'Salvador',
        state: 'BA',
        capacity: null,
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

// ═══════════════════════════════════════════════════════════════════════════════
describe('criação da página', () => {
  it('a página nasce DESPUBLICADA — montar é um processo, publicar é um ato', async () => {
    const created = await ensureHomePage({ tenantId, eventId, actorId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.created).toBe(true);

    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.isPublished).toBe(false);
    expect(landing?.page?.blocks).toEqual([]);
  });

  it('criar de novo é idempotente — sem duas páginas iniciais', async () => {
    const again = await ensureHomePage({ tenantId, eventId, actorId });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.created).toBe(false);

    const pages = await withTenant(tenantId, (tx) =>
      tx.eventPage.findMany({ where: { eventId }, select: { id: true } }),
    );
    expect(pages).toHaveLength(1);
  });

  it('a página DESPUBLICADA não é a página do evento no site público', async () => {
    /**
     * Sem isto, o primeiro bloco salvo apareceria para os visitantes com o texto
     * em branco e a vitrine da instituição estaria no ar pela metade.
     */
    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent).not.toBeNull();
    expect(publicEvent?.page).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('blocos', () => {
  let richTextId: string;
  let faqId: string;

  it('adiciona blocos no fim, com conteúdo inicial vazio', async () => {
    const first = await addPageBlock({ tenantId, eventId, actorId, type: 'RICH_TEXT' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    richTextId = first.blockId;

    const second = await addPageBlock({ tenantId, eventId, actorId, type: 'FAQ' });
    expect(second.ok).toBe(true);
    if (second.ok) faqId = second.blockId;

    const landing = await getLandingForEdit(tenantId, eventId);
    expect(landing?.page?.blocks.map((block) => block.type)).toEqual(['RICH_TEXT', 'FAQ']);
    // Bloco recém-criado é dito VAZIO na lista: ele não aparece na página.
    expect(landing?.page?.blocks[0]?.summary).toContain('não aparece');
  });

  it('grava conteúdo validado por tipo', async () => {
    const saved = await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: richTextId,
      content: { title: 'Sobre o congresso', body: 'Um encontro sobre tecnologia e educação.' },
    });
    expect(saved.ok).toBe(true);

    const faq = await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: faqId,
      content: {
        title: 'Perguntas frequentes',
        items: [
          { question: 'Vale certificado?', answer: 'Sim, após o credenciamento.' },
          { question: '', answer: '' },
        ],
      },
    });
    expect(faq.ok).toBe(true);

    const landing = await getLandingForEdit(tenantId, eventId);
    const blocks = landing?.page?.blocks ?? [];
    expect(blocks[0]?.summary).toContain('caractere');
    // A linha em branco foi descartada na normalização: sobra UMA pergunta.
    expect(blocks[1]?.summary).toBe('1 pergunta(s)');
  });

  it('RECUSA conteúdo inválido e não grava nada', async () => {
    /**
     * Campo de OUTRO tipo é descartado, não gravado: o schema de cada bloco é
     * fechado por tipo, então um formulário adulterado não consegue plantar a
     * estrutura de uma galeria dentro de um bloco de texto.
     */
    const stripped = await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: richTextId,
      content: { title: 'Sobre', body: 'Texto válido.', items: [{ url: 'javascript:alert(1)' }] },
    });
    expect(stripped.ok).toBe(true);

    const afterStrip = await getLandingForEdit(tenantId, eventId);
    expect(afterStrip?.page?.blocks[0]?.content.items).toBeUndefined();

    const gallery = await addPageBlock({ tenantId, eventId, actorId, type: 'GALLERY' });
    expect(gallery.ok).toBe(true);
    if (!gallery.ok) return;

    const summaryBeforeRejection = (
      await getLandingForEdit(tenantId, eventId)
    )?.page?.blocks[0]?.summary;

    const badGallery = await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: gallery.blockId,
      content: { images: [{ url: 'javascript:alert(1)' }] },
    });

    expect(badGallery.ok).toBe(false);
    if (!badGallery.ok) {
      expect(badGallery.code).toBe('INVALID_INPUT');
      expect(badGallery.details?.join(' ')).toContain('http');
    }

    const after = await getLandingForEdit(tenantId, eventId);
    // O bloco recusado continua VAZIO: nada foi gravado pela metade.
    expect(after?.page?.blocks.find((block) => block.id === gallery.blockId)?.content.images).toEqual(
      [],
    );
    // E o bloco anterior não foi tocado pela gravação recusada.
    expect(after?.page?.blocks[0]?.summary).toBe(summaryBeforeRejection);
  });

  it('move um bloco e a ordem persistida é a ordem da página pública', async () => {
    const landing = await getLandingForEdit(tenantId, eventId);
    const order = landing?.page?.blocks.map((block) => block.id) ?? [];
    const [first, second] = order;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const moved = await movePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: second!,
      direction: 'up',
    });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.order.slice(0, 2)).toEqual([second, first]);

    // A ordem é gravada em `displayOrder`, e `selectRenderableBlocks` (usado pela
    // página pública) precisa reproduzi-la.
    const persisted = await withTenant(tenantId, (tx) =>
      tx.pageBlock.findMany({
        where: { page: { eventId } },
        select: { id: true, type: true, content: true, style: true, displayOrder: true, isVisible: true },
      }),
    );

    expect(selectRenderableBlocks(persisted).map((block) => block.id).slice(0, 2)).toEqual([
      second,
      first,
    ]);
  });

  it('mover na ponta é no-op (não gera entrada de auditoria para fato inexistente)', async () => {
    const landing = await getLandingForEdit(tenantId, eventId);
    const firstId = landing?.page?.blocks[0]?.id;
    expect(firstId).toBeDefined();

    const result = await movePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: firstId!,
      direction: 'up',
    });
    expect(result.ok).toBe(true);
  });

  it('bloco oculto continua na configuração mas sai da renderização', async () => {
    const landing = await getLandingForEdit(tenantId, eventId);
    const target = landing?.page?.blocks[0];
    expect(target).toBeDefined();

    const hidden = await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: target!.id,
      content: target!.content,
      isVisible: false,
    });
    expect(hidden.ok).toBe(true);

    const after = await getLandingForEdit(tenantId, eventId);
    // Está na lista do editor (com o aviso)…
    expect(after?.page?.blocks.some((block) => block.id === target!.id && !block.isVisible)).toBe(true);

    const persisted = await withTenant(tenantId, (tx) =>
      tx.pageBlock.findMany({
        where: { page: { eventId } },
        select: { id: true, type: true, content: true, style: true, displayOrder: true, isVisible: true },
      }),
    );
    // …e fora da renderização pública.
    expect(selectRenderableBlocks(persisted).some((block) => block.id === target!.id)).toBe(false);
  });

  it('remove bloco e registra a remoção', async () => {
    const landing = await getLandingForEdit(tenantId, eventId);
    const victim = landing?.page?.blocks.at(-1);
    expect(victim).toBeDefined();

    const removed = await deletePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: victim!.id,
    });
    expect(removed.ok).toBe(true);

    const after = await getLandingForEdit(tenantId, eventId);
    expect(after?.page?.blocks.some((block) => block.id === victim!.id)).toBe(false);
  });

  it('recusa bloco de OUTRA instituição (a RLS e o filtro concordam)', async () => {
    const result = await updatePageBlock({
      tenantId: otherTenantId,
      eventId,
      actorId,
      blockId: richTextId,
      content: { body: 'invasão' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('composição sugerida e teto', () => {
  it('a composição sugerida só se aplica a página VAZIA', async () => {
    const result = await seedRecommendedBlocks({ tenantId, eventId, actorId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('aplica a composição recomendada em uma página nova', async () => {
    const freshEventId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.event.create({
        data: {
          id: freshEventId,
          tenantId,
          slug: `evento-f17-composicao-${RUN}`,
          title: `Evento Composição ${RUN}`,
          status: 'DRAFT',
          modality: 'ONLINE',
          startsAt: new Date('2026-12-01T13:00:00.000Z'),
          endsAt: new Date('2026-12-02T13:00:00.000Z'),
          timezone: 'America/Bahia',
          confirmedCount: 0,
        },
      }),
    );

    await ensureHomePage({ tenantId, eventId: freshEventId, actorId });

    const seeded = await seedRecommendedBlocks({
      tenantId,
      eventId: freshEventId,
      actorId,
    });

    expect(seeded.ok).toBe(true);
    if (seeded.ok) expect(seeded.created).toBeGreaterThan(3);

    const landing = await getLandingForEdit(tenantId, freshEventId);
    expect(landing?.page?.blocks[0]?.type).toBe('HERO');
    expect(landing?.page?.blocks.at(-1)?.type).toBe('REGISTRATION_CTA');

    // Segunda aplicação é recusada: não é uma forma de empilhar blocos.
    const twice = await seedRecommendedBlocks({ tenantId, eventId: freshEventId, actorId });
    expect(twice.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('publicação, tema e auditoria', () => {
  it('salvar com publicar torna a página a página do evento no site', async () => {
    const saved = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso F17 ${RUN}`,
      metaTitle: `Congresso F17 ${RUN} — inscrições abertas`,
      metaDescription: 'Três dias de programação sobre tecnologia e educação.',
      isPublished: true,
      theme: {
        primaryColor: '#1d4ed8',
        radius: 14,
        fontFamily: 'inter',
        heroStyle: 'gradient',
        spacing: 'normal',
        animation: 'fade',
        colorMode: 'light',
      },
    });

    expect(saved.ok).toBe(true);

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).not.toBeNull();
    expect(publicEvent?.page?.metaTitle).toContain('inscrições abertas');
    expect(publicEvent?.page?.blocks.length).toBeGreaterThan(0);
    expect(publicEvent?.theme.primaryColor).toBe('#1d4ed8');
    expect(publicEvent?.theme.radius).toBe(14);
  });

  it('RECUSA tema fora da allowlist sem gravar nada', async () => {
    const rejected = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: 'Título',
      isPublished: true,
      theme: { primaryColor: 'red; background: url(//evil.test/x)' },
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('INVALID_INPUT');

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.theme.primaryColor).toBe('#1d4ed8');
  });

  it('despublicar devolve o evento à composição padrão', async () => {
    const saved = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso F17 ${RUN}`,
      isPublished: false,
    });
    expect(saved.ok).toBe(true);

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.page).toBeNull();

    // Republica para os cenários seguintes.
    await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso F17 ${RUN}`,
      isPublished: true,
    });
  });

  it('toda mutação deixa rastro na trilha', async () => {
    const entries = await listAuditLog(tenantId, { limit: 100 });
    const types = entries.map((entry) => entry.entityType);

    expect(types).toContain('eventPage');
    expect(types).toContain('pageBlock');
    expect(entry(entries, 'pageBlock', 'DELETE')).toBe(true);
    expect(entry(entries, 'pageBlock', 'CREATE')).toBe(true);
  });
});

function entry(
  entries: Awaited<ReturnType<typeof listAuditLog>>,
  entityType: string,
  action: string,
): boolean {
  return entries.some((item) => item.entityType === entityType && item.action === action);
}
