/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — O CONTEXTO RESOLVIDO UMA VEZ POR RENDER (FASE 75 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As três telas de gestão chamavam `requirePagePermission` E `getRequestContext`.
 *  A guarda já resolve o contexto inteiro (sessão → vínculos → principal) para
 *  decidir a permissão, e a página pagava a MESMA leitura outra vez só para ler
 *  `principal` — ou seja, `loadMemberships` (uma consulta administrativa que
 *  atravessa tenants) e `loadPrincipal` (uma transação com contexto de RLS)
 *  rodavam DUAS vezes por render, sem que o segundo resultado pudesse diferir do
 *  primeiro (mesma sessão, mesmo cookie, mesmos vínculos).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE CONTA, EM VEZ DE OLHAR O CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Chamar uma vez" é uma propriedade de EXECUÇÃO: um `import` pode continuar no
 *  arquivo sem ser usado no caminho, e um `if` pode esconder a segunda chamada de
 *  quem lê. O teste executa as páginas de verdade, com o banco de verdade, e conta:
 *
 *    • `loadHelpers` — quantas vezes `loadMemberships` consulta
 *      `user_tenant_profiles` (a consulta que atravessa tenants);
 *    • `loadPrincipal` — quantas vezes a sessão abre a transação de
 *      `role_assignments` (o principal sob RLS).
 *
 *  O que é substituído:
 *    • o Better Auth (`getSession` lê cookie assinado e não existe fora de uma
 *      requisição do Next) — devolve a pessoa do caso;
 *    • `cookies()`/`headers()` do Next;
 *    • `notFound()`/`redirect()`, que viram sentinelas (interrompem a renderização);
 *    • os componentes de cliente da tela (o diretório de participantes), que não
 *      participam da resolução de contexto.
 *
 *  O que NÃO é substituído: `getRequestContext`, `loadMemberships`, `loadPrincipal`
 *  e as leituras das páginas — é o caminho real que se quer medir.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PAINEL ENTROU NESTA CATRACA NA FASE 84 · FATIA 2
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele não usava guarda e por isso ficou de fora da varredura da FASE 75: chamava
 *  `getRequestContext()` e `loadPrincipal()` em sequência, pagando 2 + 2 em vez de
 *  1 + 1. A fatia 2 removeu a segunda chamada, e o caso "o painel da instituição"
 *  abaixo prende o número — a catraca agora cobre administração, raiz do evento,
 *  participantes, painel e shell.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';

const RUN = randomUUID().slice(0, 8);
const TENANT_SLUG = `f75-contexto-${RUN}`;
const PESSOA_EMAIL = `f75.contexto.${RUN}@exemplo.test`;

/**
 * A SESSÃO do caso — o único dado que o dublê do Better Auth fornece. `null`
 * significa "sem sessão", que a guarda transforma em redirecionamento ao login.
 */
const sessao = vi.hoisted(() => ({ userId: null as string | null }));

/**
 * CONTADORES da execução. Cada um é incrementado no ponto exato em que o efeito
 * acontece — não no import, não na chamada da página.
 */
const contagem = vi.hoisted(() => ({
  memberships: 0,
  principals: 0,
  sessoes: 0,
}));

vi.mock('../../src/lib/auth/auth', () => ({
  auth: {
    api: {
      getSession: async () => {
        contagem.sessoes += 1;

        if (!sessao.userId) return null;

        return {
          user: {
            id: sessao.userId,
            name: 'Pessoa do teste de contexto',
            email: PESSOA_EMAIL,
            image: null,
            emailVerified: true,
            publicHandle: null,
          },
          session: {
            id: 'sessao-do-teste',
            token: 'token-do-teste',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        };
      },
    },
  },
}));

/**
 * `cookies()` vazio: sem cookie de contexto, `getRequestContext` cai no primeiro
 * vínculo ATIVO — que é o único do caso. O fallback é EXATAMENTE o comportamento
 * de produção para quem nunca trocou de instituição, e evita que o teste assine
 * um cookie só para provar o que já está provado nos testes de tenancy.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('next/link', () => ({
  /**
   * O dublê repassa os atributos que não são `href`: o painel publica
   * `data-testid` no link de contexto (FASE 84), e um dublê que só desenha `href`
   * apagaria justamente o contrato que o teste quer ver no HTML.
   */
  default: (props: { href: string; children?: unknown; [key: string]: unknown }) => {
    const { href, children, ...rest } = props;
    return createElement('a', { href, ...rest }, children as never);
  },
}));

/** Componente de cliente da tela: não participa da resolução de contexto. */
vi.mock('../../src/components/participants/participant-directory', () => ({
  ParticipantDirectory: () => null,
}));

/**
 * O shell é trocado por um contêiner: a navegação lateral é componente de cliente
 * e não participa da resolução de contexto. O que o teste lê do layout é a MARCA
 * (para provar que o corpo do layout executou) e os contadores.
 */
vi.mock('../../src/components/shell/app-shell', () => ({
  AppShell: (props: { brand?: { label: string }; children?: unknown }) =>
    createElement('div', null, props.brand?.label ?? '', props.children as never),
}));
vi.mock('../../src/components/shell/account-block', () => ({
  AccountBlock: () => null,
}));

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ONDE A CONTAGEM ACONTECE
 * ─────────────────────────────────────────────────────────────────────────────
 *  `withTenant` é o único caminho de `loadPrincipal` (uma transação por
 *  resolução). O dublê não substitui o comportamento: ele só CONTA quando a
 *  chamada vem de `auth/session.ts`, e delega ao `withTenant` real. A pilha é o
 *  que separa "o principal" das dezenas de outras transações que a página abre.
 */
vi.mock('../../src/lib/db/tenant-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/db/tenant-client')>();

  return {
    ...real,
    withTenant: async (
      tenantId: string,
      fn: (tx: Parameters<Parameters<typeof real.withTenant>[1]>[0]) => Promise<unknown>,
      options?: Parameters<typeof real.withTenant>[2],
    ) => {
      const pilha = (new Error().stack ?? '').replaceAll('\\', '/');

      if (pilha.includes('auth/session.ts') && pilha.includes('loadPrincipal')) {
        contagem.principals += 1;
      }

      return real.withTenant(tenantId, fn, options);
    },
  };
});

const { default: AdminHomePage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/page'
);
const { default: AdminEventDetailPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page'
);
const { default: ParticipantsPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/participantes/page'
);
/**
 * O PAINEL ENTROU NA CATRACA NA FASE 84 · FATIA 2.
 *
 * Ele chamava `loadPrincipal` por fora do contexto que já tinha vindo pronto:
 * a SEGUNDA transação de `role_assignments` no mesmo render, com os mesmos
 * argumentos e sem chance de a resposta divergir. A página deixou de chamar; o
 * caso abaixo prende o número.
 */
const { default: DashboardPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/dashboard/page'
);
const { default: TenantLayout } = await import('../../src/app/t/[tenantSlug]/(app)/layout');

let tenantId: string;
let eventId: string;
let pessoaId: string;

/** A leitura que `loadMemberships` faz — contada só quando vem da sessão. */
type FindMany = (...args: unknown[]) => Promise<unknown>;

let findManyOriginal: FindMany;

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do contexto único ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  pessoaId = randomUUID();

  await adminPrisma.user.create({
    data: {
      id: pessoaId,
      name: `Dona do contexto ${RUN}`,
      email: PESSOA_EMAIL,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: pessoaId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  /**
   * `OWNER` é o papel que autoriza as três telas (todos os `TENANT_PERMISSIONS`).
   * O caso é de CONTAGEM, não de RBAC — a recusa é território das fatias 1–2.
   */
  await withTenant(tenantId, (tx) =>
    tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: pessoaId,
        role: 'OWNER',
        scope: 'TENANT',
      },
    }),
  );

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-contexto-${RUN}`,
        title: 'Evento do contexto único',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    }),
  );

  /**
   * A contagem de `loadMemberships` usa o delegado REAL de `user_tenant_profiles`.
   * A pilha separa a leitura do contexto de qualquer outra consulta a perfis que
   * uma das telas venha a fazer (o diretório de participantes, por exemplo).
   */
  const delegado = adminPrisma.userTenantProfile as unknown as { findMany: FindMany };
  findManyOriginal = delegado.findMany.bind(delegado);

  vi.spyOn(delegado, 'findMany').mockImplementation(async (...args: unknown[]) => {
    const pilha = (new Error().stack ?? '').replaceAll('\\', '/');

    if (pilha.includes('auth/session.ts') && pilha.includes('loadMemberships')) {
      contagem.memberships += 1;
    }

    return findManyOriginal(...args);
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: PESSOA_EMAIL } });
  await adminPrisma.$disconnect();
});

beforeEach(() => {
  sessao.userId = pessoaId;
  contagem.memberships = 0;
  contagem.principals = 0;
  contagem.sessoes = 0;
});

/** Renderiza como o Next faria e devolve o HTML — a página inteira, não um trecho. */
async function renderizar(elemento: React.ReactElement): Promise<string> {
  return renderToStaticMarkup(elemento);
}

/**
 * As três telas que resolviam o contexto duas vezes.
 *
 * A asserção é `toBe(1)` — não `toBeLessThan(2)`: o número é CONTRATO. Se uma
 * página voltar a chamar `getRequestContext`, volta para 2 e o teste reprova aqui
 * (e a catraca de fonte em `tests/unit/f75-contexto-uma-vez.test.ts` reprova sem
 * precisar de banco).
 */
describe('o contexto da requisição é resolvido UMA vez por render', () => {
  it('administração da instituição: 1 memberships + 1 principal', async () => {
    const pagina = await AdminHomePage({
      params: Promise.resolve({ tenantSlug: TENANT_SLUG }),
    });

    const html = await renderizar(pagina);

    expect(html).toContain('Áreas de gestão');
    expect(contagem.memberships).toBe(1);
    expect(contagem.principals).toBe(1);
    /** Cross-check: cada resolução de contexto pergunta a sessão UMA vez. */
    expect(contagem.sessoes).toBe(1);
  });

  it('raiz do evento: 1 memberships + 1 principal', async () => {
    const pagina = await AdminEventDetailPage({
      params: Promise.resolve({ tenantSlug: TENANT_SLUG, eventId }),
    });

    const html = await renderizar(pagina);

    expect(html).toContain('Evento do contexto único');
    expect(contagem.memberships).toBe(1);
    expect(contagem.principals).toBe(1);
    /** Cross-check: cada resolução de contexto pergunta a sessão UMA vez. */
    expect(contagem.sessoes).toBe(1);
  });

  it('diretório de participantes: 1 memberships + 1 principal', async () => {
    const pagina = await ParticipantsPage({
      params: Promise.resolve({ tenantSlug: TENANT_SLUG }),
      searchParams: Promise.resolve({}),
    });

    const html = await renderizar(pagina);

    expect(html).toContain('Participantes');
    expect(contagem.memberships).toBe(1);
    expect(contagem.principals).toBe(1);
    /** Cross-check: cada resolução de contexto pergunta a sessão UMA vez. */
    expect(contagem.sessoes).toBe(1);
  });

  /**
   * O PAINEL MEDIA 2 + 2 — e passou a medir 1 + 1 (FASE 84 · fatia 2).
   *
   * Ele não usava guarda: chamava `getRequestContext()` e, logo abaixo,
   * `loadPrincipal(context.user.id, tenantId, status)` com os MESMOS argumentos. A
   * segunda transação não podia devolver outra coisa — o principal já estava no
   * contexto. A página agora lê `context.principal` e o número abaixo é o contrato:
   * se a chamada voltar, este caso reprova (e a catraca de fonte reprova sem banco).
   */
  it('o painel da instituição: 1 memberships + 1 principal', async () => {
    const pagina = await DashboardPage({
      params: Promise.resolve({ tenantSlug: TENANT_SLUG }),
    });

    const html = await renderizar(pagina);

    expect(html).toContain(`Painel de Instituição do contexto único ${RUN}`);
    expect(html).toContain('data-testid="dashboard-context"');
    expect(contagem.memberships).toBe(1);
    expect(contagem.principals).toBe(1);
    /** Cross-check: cada resolução de contexto pergunta a sessão UMA vez. */
    expect(contagem.sessoes).toBe(1);
  });

  /**
   * O SHELL também resolvia o principal duas vezes: `getRequestContext` já o
   * carrega, e o layout chamava `loadPrincipal` de novo logo abaixo, com os mesmos
   * argumentos. Medido com a mesma instrumentação: antes 1 memberships + 2
   * principals; depois 1 + 1.
   */
  it('o shell da instituição: 1 memberships + 1 principal', async () => {
    const layout = await TenantLayout({
      params: Promise.resolve({ tenantSlug: TENANT_SLUG }),
      children: createElement('p', null, 'conteúdo da tela'),
    });

    const html = await renderizar(layout);

    expect(html).toContain('EventFlow');
    expect(contagem.memberships).toBe(1);
    expect(contagem.principals).toBe(1);
    expect(contagem.sessoes).toBe(1);
  });
});
