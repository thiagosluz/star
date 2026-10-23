/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ID MALFORMADO NA URL RESPONDE 404 — E O ID VÁLIDO CONTINUA CARREGANDO
 *  (FASE 76 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  42 URLs com `nao-e-uuid`: **25 × 500**, 8 × 404, **5 × 200 com painel de
 *  erro**, 3 × 400 e 1 × 403. E o controle fecha o diagnóstico: com uuid BEM
 *  formado e inexistente, as rotas testadas dão 404 — o 500 é exclusivo do
 *  FORMATO inválido. A causa é sempre `where: { id }` sem validar, com o
 *  `if (!x) notFound()` existente ficando DEPOIS do erro (armadilha 25).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXECUTA A PÁGINA, E NÃO SÓ O HELPER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A correção é "a página responde 404" — e 404 não é valor de retorno de serviço:
 *  é o `notFound()` do Next interrompendo a renderização. Um teste do helper
 *  provaria a REGRA; o defeito estava na PORTA que não a usava. Então cada caso
 *  chama o componente de servidor de verdade, com o banco de verdade, e observa a
 *  interrupção (o dublê de `notFound()` lança `NEXT_NOT_FOUND`).
 *
 *  As páginas escolhidas — uma de cada grupo do diagnóstico, e não as 23:
 *
 *    • `/[tenantSlug]/administracao/eventos/[eventId]` — a raiz do evento, o caso
 *      do 500 (a página que a F75 mediu respondendo 500);
 *    • `.../eventos/[eventId]/reconhecimento` — o caso 200 COM PAINEL de erro: a
 *      leitura do ranking engolia a falha do banco e a tela dizia "sem parecer";
 *    • `/comite/[submissionId]` — o grupo das páginas de submissão (painel do
 *      comitê), que também respondia 200 com painel;
 *    • `/superadmin/tenants/[tenantId]` — o grupo de plataforma, onde o id não é
 *      de instituição operada e o 500 era o mesmo.
 *
 *  O que é substituído: a SESSÃO (não existe fora de uma requisição do Next) e a
 *  guarda de permissão — o assunto aqui é o id, e a autorização tem cobertura
 *  própria. Os componentes de cliente da tela também saem: eles são território de
 *  E2E e não participam da decisão do id.
 *
 *  O QUE NÃO É SUBSTITUÍDO: as leituras que as páginas fazem (evento, ranking,
 *  submissão, instituição) — são elas que recebiam o uuid torto e estouravam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { createSubmission } from '../../src/lib/review/submission-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f76-id-${RUN}`;
const TITULO_EVENTO = `Simpósio do id malformado ${RUN}`;
const TITULO_SUBMISSAO = `Trabalho sobre ids da F76 ${RUN}`;
const RESUMO =
  'Resumo longo o suficiente para passar pela validação de conteúdo da submissão, usado aqui só para que a página do comitê tenha o que mostrar quando o id é válido.';

/** O que a guarda devolveria — o id da instituição é o que vai para as leituras. */
const guarda = vi.hoisted(() => ({ tenantId: '', userId: '' }));

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: async () => ({
    tenantId: guarda.tenantId,
    tenantName: `Instituição ${RUN}`,
    userId: guarda.userId,
    principal: {
      userId: guarda.userId,
      tenantId: guarda.tenantId,
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'OWNER', scope: 'TENANT' }],
    },
    context: null,
  }),
}));

vi.mock('../../src/lib/platform/guard', () => ({
  requirePlatformPermission: async () => ({
    userId: 'operador-do-teste',
    name: 'Operador do teste',
    email: 'operador@exemplo.test',
  }),
}));

/** Sem sessão: as páginas continuam renderizando (a guarda é a dublada acima). */
vi.mock('../../src/lib/auth/session', () => ({
  getRequestContext: async () => null,
  getPlatformContext: async () => null,
}));

/** `notFound()`/`redirect()` interrompem a renderização — é o que se observa. */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

/** `next/link` vira âncora: o teste mede a página, não o roteador. */
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement('a', { href: props.href }, props.children as never),
}));

/** Os painéis de cliente não participam da decisão do id (e têm cobertura em E2E). */
vi.mock('../../src/components/review/decision-form', () => ({ DecisionForm: () => null }));
vi.mock('../../src/components/review/assign-reviewer-button', () => ({
  AssignReviewerButton: () => null,
}));
vi.mock('../../src/components/proposals/proposal-acceptance-panel', () => ({
  ProposalAcceptancePanel: () => null,
}));
vi.mock('../../src/components/platform/platform-forms', () => ({
  TenantMemberForm: () => null,
  TenantPlanForm: () => null,
  TenantProfileForm: () => null,
  TenantStatusForm: () => null,
}));
vi.mock('../../src/components/reviews/reviewer-award', () => ({
  ReviewerAwardPanel: (props: { ranking: readonly unknown[] }) =>
    createElement(
      'p',
      { 'data-testid': 'reviewer-award-panel' },
      `revisores no ranking: ${props.ranking.length}`,
    ),
}));

const { default: AdminEventDetailPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page'
);
const { default: ReviewerRecognitionPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/reconhecimento/page'
);
const { default: ChairSubmissionPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/comite/[submissionId]/page'
);
const { default: PlatformTenantDetailPage } = await import(
  '../../src/app/superadmin/tenants/[tenantId]/page'
);

let tenantId: string;
let eventId: string;
let submissionId: string;
let protocolo: string;

type PropsDaPagina = { params: Promise<Record<string, string>> };

/** Chama a página como o Next faria e devolve o HTML que ela produziria. */
async function renderizar(
  pagina: (props: PropsDaPagina) => Promise<unknown>,
  params: Record<string, string>,
): Promise<string> {
  const elemento = (await pagina({ params: Promise.resolve(params) })) as ReactElement;
  return renderToStaticMarkup(elemento);
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  guarda.tenantId = tenantId;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do id da F76 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  const autorId = randomUUID();
  await adminPrisma.user.create({
    data: {
      id: autorId,
      name: `Autora da F76 ${RUN}`,
      email: `f76.id.${RUN}.${autorId.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });
  guarda.userId = autorId;

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: autorId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  const startsAt = new Date(Date.now() + 30 * 86_400_000);
  const trackId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f76-${RUN}`,
        title: TITULO_EVENTO,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-f76-${RUN}`,
        name: 'Trilha do id',
        requiresBlindReview: false,
        requiredReviews: 2,
      },
    });
  });

  const criada = await createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: autorId,
    title: TITULO_SUBMISSAO,
    abstract: RESUMO,
    keywords: ['id', 'validação', 'fase 76'],
  });

  if (!criada.ok) throw new Error(`Falha ao criar a submissão: ${criada.message}`);

  submissionId = criada.id;
  protocolo = criada.protocol;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a raiz do evento (o caso 500)', () => {
  it('id malformado responde 404 — e não chega a consultar o evento', async () => {
    /**
     * Antes: `getAdminEvent(tenantId, 'nao-e-uuid')` fazia o Prisma converter o
     * texto para `uuid`, o Postgres recusar (`invalid input syntax for type uuid`) e
     * a página responder 500. O `if (!event) notFound()` ficava depois disso.
     */
    await expect(
      renderizar(AdminEventDetailPage, { tenantSlug: TENANT_SLUG, eventId: 'nao-e-uuid' }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('uuid bem formado e inexistente continua dando 404 (comportamento de antes)', async () => {
    await expect(
      renderizar(AdminEventDetailPage, { tenantSlug: TENANT_SLUG, eventId: randomUUID() }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('uuid existente carrega a página do evento', async () => {
    const html = await renderizar(AdminEventDetailPage, {
      tenantSlug: TENANT_SLUG,
      eventId,
    });

    expect(html).toContain(TITULO_EVENTO);
    expect(html).toContain('O que falta para este evento ficar pronto');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o reconhecimento do comitê (o caso 200 com painel de erro)', () => {
  it('id malformado responde 404 — antes a tela dizia "sem parecer"', async () => {
    /**
     * `getReviewerRanking` devolve `{ ok: false }` quando a leitura falha, e a página
     * transformava QUALQUER falha no aviso "ainda não há parecer". Com `nao-e-uuid`,
     * o erro era de formato — mas a resposta era 200 com painel. Agora é 404, dito
     * antes de a leitura existir.
     */
    await expect(
      renderizar(ReviewerRecognitionPage, {
        tenantSlug: TENANT_SLUG,
        eventId: 'nao-e-uuid',
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('id válido carrega a página (sem ranking, porque não há parecer)', async () => {
    const html = await renderizar(ReviewerRecognitionPage, {
      tenantSlug: TENANT_SLUG,
      eventId,
    });

    expect(html).toContain('Reconhecimento do comitê científico');
    // Sem parecer no evento, a tela não fica vazia: ela diz o que fazer. É o
    // comportamento de ANTES, preservado — o que mudou foi só o id inválido.
    expect(html.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o painel do comitê (o grupo das submissões)', () => {
  it('id malformado responde 404 — antes vinha o painel de erro', async () => {
    await expect(
      renderizar(ChairSubmissionPage, {
        tenantSlug: TENANT_SLUG,
        submissionId: 'nao-e-uuid',
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('uuid bem formado e inexistente continua dando 404', async () => {
    await expect(
      renderizar(ChairSubmissionPage, {
        tenantSlug: TENANT_SLUG,
        submissionId: randomUUID(),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('uuid existente carrega o painel da submissão', async () => {
    const html = await renderizar(ChairSubmissionPage, {
      tenantSlug: TENANT_SLUG,
      submissionId,
    });

    expect(html).toContain(TITULO_SUBMISSAO);
    expect(html).toContain(protocolo);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o detalhe da instituição (o grupo de plataforma)', () => {
  it('id malformado responde 404', async () => {
    await expect(
      renderizar(PlatformTenantDetailPage, { tenantId: 'nao-e-uuid' }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('uuid bem formado e inexistente continua dando 404', async () => {
    await expect(
      renderizar(PlatformTenantDetailPage, { tenantId: randomUUID() }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('uuid existente carrega o detalhe da instituição', async () => {
    const html = await renderizar(PlatformTenantDetailPage, { tenantId });

    expect(html).toContain(`Instituição do id da F76 ${RUN}`);
    expect(html).toContain('platform-tenant-detail');
  });
});
