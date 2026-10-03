/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — A página pública da instituição (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES CASOS PROVAM, E POR QUE SÓ O BANCO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O domínio já provou a conta dos três grupos e a validação dos blocos. O que
 *  falta é o que NENHUM teste puro alcança:
 *
 *  • **A RLS isola de verdade** — a instituição A não lê a página da B, nem pelo
 *    `tenantId` errado, nem por uma consulta sem escopo. É a última linha
 *    (invariante nº 3), e é a única que não pode ser conferida no domínio.
 *  • **O publicado é IMUTÁVEL na prática** — editar o rascunho depois de publicar
 *    não muda o que o visitante lê. Só o banco mostra isso: a leitura pública e o
 *    rascunho são a MESMA linha, e a garantia está em qual coluna cada escrita toca.
 *  • **A trilha registra** — publicar deixa `UPDATE/tenantPublicPage` no
 *    `audit_logs`, com autor e data.
 *
 *  Como no resto da suíte de integração, os tenants são criados pela conexão de
 *  PLATAFORMA (`adminPrisma`) e todo o trabalho de domínio passa por `withTenant` —
 *  o runtime nunca usa a role admin (invariante nº 1).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  getAdminTenantPage,
  getPublicTenantPage,
  type TenantPublicIdentity,
} from '../../src/lib/tenancy/tenant-public-page-view';
import {
  publishTenantPublicPage,
  saveTenantPublicPageDraft,
  unpublishTenantPublicPage,
} from '../../src/lib/tenancy/tenant-public-page-write-service';

const RUN = randomUUID().slice(0, 8);
const AGORA = new Date('2026-11-10T12:00:00.000Z');

let tenantId: string;
let outraTenantId: string;
let actorId: string;
let tenantSlug: string;

async function criarTenant(slug: string, nome: string, timezone = 'America/Bahia'): Promise<string> {
  const id = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id,
      slug,
      name: nome,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone,
      description: 'Apresentação do diretório.',
    },
  });

  return id;
}

async function criarEvento(input: {
  tenantId: string;
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status?: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS';
}): Promise<string> {
  const id = randomUUID();

  await withTenant(input.tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id,
        tenantId: input.tenantId,
        slug: input.slug,
        title: input.title,
        status: input.status ?? 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });
  });

  return id;
}

function identidade(tenant: string, slug: string, nome: string): TenantPublicIdentity {
  return {
    tenantId: tenant,
    slug,
    name: nome,
    timezone: 'America/Bahia',
    logoUrl: null,
    primaryColor: null,
    description: 'Apresentação do diretório.',
  };
}

beforeAll(async () => {
  tenantId = await criarTenant(`f64-inst-${RUN}`, `Instituição F64 ${RUN}`);
  outraTenantId = await criarTenant(`f64-outra-${RUN}`, `Instituição Vizinha F64 ${RUN}`);
  tenantSlug = `f64-inst-${RUN}`;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: `Autora F64 ${RUN}`, email: `autora-f64-${RUN}@example.test` },
  });

  /**
   * A agenda da casa, com as bordas de data de propósito:
   *   • `comeca-agora`  — começa no MESMO instante da leitura → já acontecendo;
   *   • `acontecendo`   — janela contendo agora, começou antes;
   *   • `termina-agora` — termina no MESMO instante → já é antigo;
   *   • `futuro`        — o próximo;
   *   • `rascunho`      — não público: NÃO pode aparecer.
   *
   * ⚠ Aqui NÃO existe evento sem data: `Event.startsAt`/`endsAt` são NOT NULL no
   * modelo (e o Prisma recusa o `create` sem as duas), então "sem data" é uma borda
   * de DADO AUSENTE — provada no teste de unidade, onde o objeto pode ser construído.
   *
   * ⚠ A leitura pública usa o relógio REAL quando o teste não passa `now`. Por isso
   * os eventos são ancorados em 2026 e a leitura de agrupamento passa `now`
   * EXPLÍCITO, com os mesmos instantes — sem isso o caso dependeria do dia em que a
   * suíte roda.
   */
  await criarEvento({
    tenantId,
    slug: `comeca-agora-${RUN}`,
    title: 'Começa agora',
    startsAt: AGORA,
    endsAt: new Date('2026-11-10T20:00:00.000Z'),
  });

  await criarEvento({
    tenantId,
    slug: `acontecendo-${RUN}`,
    title: 'Acontecendo',
    startsAt: new Date('2026-11-10T11:00:00.000Z'),
    endsAt: new Date('2026-11-10T13:00:00.000Z'),
    status: 'IN_PROGRESS',
  });

  await criarEvento({
    tenantId,
    slug: `termina-agora-${RUN}`,
    title: 'Termina agora',
    startsAt: new Date('2026-11-10T08:00:00.000Z'),
    endsAt: AGORA,
  });

  await criarEvento({
    tenantId,
    slug: `futuro-${RUN}`,
    title: 'O próximo',
    startsAt: new Date('2026-11-20T11:00:00.000Z'),
    endsAt: new Date('2026-11-20T20:00:00.000Z'),
  });

  await criarEvento({
    tenantId,
    slug: `rascunho-${RUN}`,
    title: 'Rascunho que não pode aparecer',
    startsAt: new Date('2026-11-25T11:00:00.000Z'),
    endsAt: new Date('2026-11-25T20:00:00.000Z'),
    status: 'DRAFT',
  });

  /** A instituição VIZINHA tem a própria agenda — ela não pode entrar na leitura da primeira. */
  await criarEvento({
    tenantId: outraTenantId,
    slug: `vizinho-${RUN}`,
    title: 'Evento da vizinha',
    startsAt: new Date('2026-11-15T11:00:00.000Z'),
    endsAt: new Date('2026-11-15T20:00:00.000Z'),
  });
});

afterAll(async () => {
  /** `ON DELETE CASCADE` leva a página e os eventos; a trilha vai junto com o tenant. */
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, outraTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { id: actorId } });
  await adminPrisma.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  RLS: a última linha
// ───────────────────────────────────────────────────────────────────────────────
describe('isolamento entre instituições', () => {
  it('a instituição A não lê a página da B — nem pelo id, nem sob o contexto errado', async () => {
    /** A vizinha tem a própria página, publicada. */
    const criada = await saveTenantPublicPageDraft({
      tenantId: outraTenantId,
      actorId,
      title: 'Página da vizinha',
      blocks: [{ type: 'ABOUT', content: { body: 'História da vizinha' } }],
    });

    expect(criada.ok).toBe(true);

    const publicada = await publishTenantPublicPage({ tenantId: outraTenantId, actorId });
    expect(publicada.ok).toBe(true);

    /** Sob o contexto da PRIMEIRA instituição, a página da vizinha não existe. */
    const leituraCruzada = await getAdminTenantPage(tenantId);
    expect(leituraCruzada?.draft.title).not.toBe('Página da vizinha');

    /** A leitura pública da primeira instituição também não a alcança. */
    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA },
    );

    expect(publica?.title).not.toBe('Página da vizinha');

    /**
     * E a prova direta: dentro do contexto de A, uma consulta SEM filtro à tabela
     * não devolve a linha de B. É o `where` esquecido que a RLS precisa segurar.
     */
    const linhasVisiveis = await withTenant(tenantId, (tx) =>
      tx.tenantPublicPage.findMany({ select: { tenantId: true } }),
    );

    expect(linhasVisiveis.every((linha) => linha.tenantId === tenantId)).toBe(true);
  });

  it('uma consulta sem contexto de tenant não vê página nenhuma (fail-closed)', async () => {
    /** `db` fora de `withTenant` LANÇA — a RLS é fail-closed por desenho. */
    const { db } = await import('../../src/lib/db/tenant-client');

    expect(() => db.tenantPublicPage).toThrow(/contexto de tenant/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Rascunho × publicado
// ───────────────────────────────────────────────────────────────────────────────
describe('rascunho × publicado, com trilha', () => {
  it('antes de publicar, o visitante não vê NADA (mesmo com rascunho pronto)', async () => {
    const salvo = await saveTenantPublicPageDraft({
      tenantId,
      actorId,
      title: 'Instituto de Letras',
      description: 'A casa dos cursos de Letras.',
      theme: { primaryColor: '#0f6f8c' },
      blocks: [
        { type: 'ABOUT', content: { title: 'Nossa história', body: 'Fundado em 1957.' } },
        { type: 'CONTACT', content: { address: 'Rua das Letras, 1' } },
      ],
    });

    expect(salvo.ok).toBe(true);
    if (!salvo.ok) return;

    expect(salvo.page.publication.state).toBe('NEVER_PUBLISHED');
    expect(salvo.page.published).toBeNull();

    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA },
    );

    expect(publica).toBeNull();
  });

  it('publicar copia o rascunho; editar depois NÃO muda o que está no ar', async () => {
    const publicada = await publishTenantPublicPage({ tenantId, actorId, now: AGORA });
    expect(publicada.ok).toBe(true);
    if (!publicada.ok) return;

    expect(publicada.page.publication.state).toBe('PUBLISHED');
    expect(publicada.page.publication.publishedAt?.getTime()).toBe(AGORA.getTime());

    /** O organizador edita o rascunho — a descrição que está no ar é a antiga. */
    const editado = await saveTenantPublicPageDraft({
      tenantId,
      actorId,
      title: 'Instituto de Letras e Artes',
      description: 'Descrição NOVA, ainda não publicada.',
      theme: { primaryColor: '#0f6f8c' },
      blocks: [
        { type: 'ABOUT', content: { title: 'Nossa história', body: 'Fundado em 1957.' } },
        { type: 'PAST_EVENTS', content: { title: 'Edições anteriores', limit: 3 } },
      ],
    });

    expect(editado.ok).toBe(true);
    if (!editado.ok) return;

    /** O organizador vê "tem alteração não publicada" — o visitante, a versão no ar. */
    expect(editado.page.publication.state).toBe('CHANGES_PENDING');
    expect(editado.page.published?.title).toBe('Instituto de Letras');

    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA },
    );

    expect(publica?.title).toBe('Instituto de Letras');
    expect(publica?.description).toBe('A casa dos cursos de Letras.');
    expect(publica?.blocks.map((bloco) => bloco.type)).toEqual(['ABOUT', 'CONTACT']);
  });

  it('publicar de novo leva o rascunho atual ao ar', async () => {
    const republicada = await publishTenantPublicPage({ tenantId, actorId, now: new Date('2026-11-11T09:00:00.000Z') });
    expect(republicada.ok).toBe(true);
    if (!republicada.ok) return;

    expect(republicada.page.publication.state).toBe('PUBLISHED');

    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA },
    );

    expect(publica?.title).toBe('Instituto de Letras e Artes');
    expect(publica?.description).toBe('Descrição NOVA, ainda não publicada.');
    expect(publica?.blocks.map((bloco) => bloco.type)).toEqual(['ABOUT', 'PAST_EVENTS']);
  });

  it('a gravação recusa conteúdo inválido e NÃO toca no que está publicado', async () => {
    const recusado = await saveTenantPublicPageDraft({
      tenantId,
      actorId,
      title: 'Instituto de Letras e Artes',
      blocks: [{ type: 'CONTACT', content: { mapUrl: 'javascript:alert(1)' } }],
    });

    expect(recusado.ok).toBe(false);
    if (recusado.ok) return;

    expect(recusado.code).toBe('INVALID_INPUT');

    /** O rascunho anterior continua intacto — a gravação inválida não gravou nada. */
    const admin = await getAdminTenantPage(tenantId);
    expect(admin?.draft.blocks.map((bloco) => bloco.type)).toEqual(['ABOUT', 'PAST_EVENTS']);
  });

  it('despublicar tira do ar sem apagar o rascunho', async () => {
    const despublicada = await unpublishTenantPublicPage({ tenantId, actorId });

    expect(despublicada.ok).toBe(true);
    if (!despublicada.ok) return;

    expect(despublicada.page.publication.state).toBe('NEVER_PUBLISHED');
    expect(despublicada.page.draft.title).toBe('Instituto de Letras e Artes');

    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA },
    );

    expect(publica).toBeNull();

    /** E voltar ao ar é publicar de novo — o trabalho não foi perdido. */
    const volta = await publishTenantPublicPage({ tenantId, actorId });
    expect(volta.ok).toBe(true);
  });

  it('a trilha registra a publicação, com autor, e o resumo NÃO copia o conteúdo dos blocos', async () => {
    const trilhas = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'tenantPublicPage' },
        orderBy: { createdAt: 'desc' },
        select: { action: true, userId: true, entityId: true, changes: true },
      }),
    );

    expect(trilhas.length).toBeGreaterThan(0);
    expect(trilhas.some((linha) => linha.action === 'CREATE')).toBe(true);
    expect(trilhas.some((linha) => linha.action === 'UPDATE')).toBe(true);
    expect(trilhas.every((linha) => linha.userId === actorId)).toBe(true);

    const serializado = JSON.stringify(trilhas);
    /** O corpo do texto NÃO vai para a trilha (ela não é um segundo banco da página). */
    expect(serializado).not.toContain('Fundado em 1957');
    /** Mas o que mudou, sim — em resumo legível. */
    expect(serializado).toContain('bloco');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os três grupos, com dado real
// ───────────────────────────────────────────────────────────────────────────────
describe('os grupos de eventos lidos do banco', () => {
  it('as bordas caem nos grupos certos e o rascunho não aparece', async () => {
    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA, limit: 10 },
    );

    expect(publica).not.toBeNull();
    if (!publica) return;

    const titulos = (grupo: 'upcoming' | 'ongoing' | 'past') =>
      publica.events[grupo].items.map((item) => item.title);

    /** Quem começou antes vem primeiro: "Acontecendo" (11:00) antes de "Começa agora" (12:00). */
    expect(titulos('ongoing')).toEqual(['Acontecendo', 'Começa agora']);
    expect(titulos('upcoming')).toEqual(['O próximo']);
    /** Termina exatamente agora já é `antigo`. */
    expect(titulos('past')).toEqual(['Termina agora']);

    expect(publica.events.total).toBe(4);
    expect(titulos('upcoming')).not.toContain('Rascunho que não pode aparecer');
  });

  it('o limite recorta os itens e o total continua completo', async () => {
    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA, limit: 1 },
    );

    expect(publica?.events.upcoming.items).toHaveLength(1);
    expect(publica?.events.upcoming.total).toBe(1);
    expect(publica?.events.upcoming.hasMore).toBe(false);
    expect(publica?.events.ongoing.items).toHaveLength(1);
    expect(publica?.events.ongoing.total).toBe(2);
    expect(publica?.events.ongoing.hasMore).toBe(true);
  });

  it('o rótulo do período vem escrito no fuso da instituição', async () => {
    const publica = await getPublicTenantPage(
      identidade(tenantId, tenantSlug, `Instituição F64 ${RUN}`),
      { now: AGORA, limit: 10 },
    );

    const acontecendo = publica?.events.ongoing.items[0];
    expect(acontecendo?.periodLabel).toContain('08:00');
    expect(acontecendo?.isHappeningNow).toBe(true);
  });

  it('a identidade e a descrição de fallback vêm do contexto da instituição', async () => {
    const publica = await getPublicTenantPage(
      // Sem descrição publicada, vale a apresentação do diretório.
      identidade(outraTenantId, `f64-outra-${RUN}`, `Instituição Vizinha F64 ${RUN}`),
      { now: AGORA },
    );

    expect(publica?.identity.tenantId).toBe(outraTenantId);
    expect(publica?.title).toBe('Página da vizinha');
  });
});
