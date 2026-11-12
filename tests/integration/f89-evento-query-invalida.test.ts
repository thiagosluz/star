/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  `?evento=` INVÁLIDO OU AUSENTE DA LISTA NÃO CAI EM OUTRO EVENTO EM SILÊNCIO
 *  (FASE 89 · fatia 2 · dívida E89 · ADR-395)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nas cinco telas que carregam primeiro `events` e depois escolhem `?evento=`
 *  (`/credenciamento`, `/credenciamento/crachas`, `/meu-cracha`, `/minha-agenda` e
 *  `/participantes`), o ternário `evento && events.some(...) ? evento : fallback`
 *  tratava qualquer valor que não casasse com `events` — texto malformado
 *  (`?evento=nao-e-uuid`), parâmetro repetido ou um UUID de evento inexistente /
 *  rascunho / de outra instituição — exatamente como AUSÊNCIA de parâmetro. No
 *  balcão, pedir um evento e cair em outro sem aviso induzia leitura ou emissão no
 *  evento errado.
 *
 *  Este teste renderiza as 5 páginas reais contra o banco PostgreSQL real e prova
 *  que os três casos (malformado, UUID ausente da lista e UUID válido presente)
 *  respondem 200 com o fallback determinístico e o alerta canônico do domínio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  discardedEventSelectionNotice,
  discardedFilterNotice,
} from '../../src/domain/validation/query-filter-rules';

const RUN = randomUUID().slice(0, 8);
const TENANT_SLUG = `f89-evento-${RUN}`;
const UUID_MALFORMADO = 'nao-e-uuid';
const UUID_AUSENTE = randomUUID();

const TITULO_PRIMEIRO = `Congresso Primeiro ${RUN}`;
const TITULO_SEGUNDO = `Simpósio Segundo ${RUN}`;
const NOME_PESSOA_PRIMEIRO = `Participante Primeiro ${RUN}`;
const NOME_PESSOA_SEGUNDO = `Participante Segundo ${RUN}`;

const contextoMock = vi.hoisted(() => ({
  tenantId: '',
  tenantSlug: '',
  tenantName: '',
  userId: '',
  userName: '',
  userEmail: '',
}));

vi.mock('../../src/lib/auth/guard-page', () => ({
  requirePagePermission: async () => ({
    tenantId: contextoMock.tenantId,
    tenantName: contextoMock.tenantName,
    userId: contextoMock.userId,
    principal: {
      userId: contextoMock.userId,
      tenantId: contextoMock.tenantId,
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'OWNER', scope: 'TENANT' }],
    },
    context: {
      tenant: {
        id: contextoMock.tenantId,
        slug: contextoMock.tenantSlug,
        name: contextoMock.tenantName,
        status: 'ACTIVE',
      },
      user: {
        id: contextoMock.userId,
        email: contextoMock.userEmail,
        name: contextoMock.userName,
        isSuperAdmin: false,
      },
      membership: {
        tenantId: contextoMock.tenantId,
        status: 'ACTIVE',
        kind: 'MEMBER',
      },
      memberships: [],
      principal: {
        userId: contextoMock.userId,
        tenantId: contextoMock.tenantId,
        membershipStatus: 'ACTIVE',
        assignments: [{ role: 'OWNER', scope: 'TENANT' }],
      },
    },
  }),
}));

vi.mock('../../src/lib/auth/session', () => ({
  getRequestContext: async () => ({
    tenant: {
      id: contextoMock.tenantId,
      slug: contextoMock.tenantSlug,
      name: contextoMock.tenantName,
      status: 'ACTIVE',
    },
    activeTenant: {
      tenantId: contextoMock.tenantId,
      tenantSlug: contextoMock.tenantSlug,
      tenantName: contextoMock.tenantName,
      status: 'ACTIVE',
      kind: 'MEMBER',
    },
    user: {
      id: contextoMock.userId,
      email: contextoMock.userEmail,
      name: contextoMock.userName,
      isSuperAdmin: false,
    },
    membership: {
      tenantId: contextoMock.tenantId,
      status: 'ACTIVE',
      kind: 'MEMBER',
    },
    memberships: [],
    principal: {
      userId: contextoMock.userId,
      tenantId: contextoMock.tenantId,
      membershipStatus: 'ACTIVE',
      assignments: [{ role: 'OWNER', scope: 'TENANT' }],
    },
  }),
  loadPrincipal: async () => ({
    userId: contextoMock.userId,
    tenantId: contextoMock.tenantId,
    membershipStatus: 'ACTIVE',
    assignments: [{ role: 'OWNER', scope: 'TENANT' }],
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '',
}));

vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) =>
    createElement('a', { href: props.href }, props.children as never),
}));

vi.mock('../../src/components/credentials/monitor-console', () => ({
  MonitorConsole: (props: { eventId: string; eventTitle: string }) =>
    createElement(
      'div',
      { 'data-testid': 'monitor-selected-event' },
      `${props.eventId}:${props.eventTitle}`,
    ),
}));

vi.mock('../../src/components/gamification/checkin-queue', () => ({
  CheckinQueue: () => null,
}));

vi.mock('../../src/components/credentials/badge-roster', () => ({
  BadgeRoster: (props: { eventId: string }) =>
    createElement('div', { 'data-testid': 'roster-selected-event' }, props.eventId),
}));

vi.mock('../../src/components/credentials/own-badge', () => ({
  OwnBadge: (props: { eventId: string; eventTitle: string }) =>
    createElement(
      'div',
      { 'data-testid': 'own-badge-selected-event' },
      `${props.eventId}:${props.eventTitle}`,
    ),
}));

vi.mock('../../src/components/participants/participant-directory', () => ({
  ParticipantDirectory: (props: { entries: ReadonlyArray<{ name: string }> }) =>
    createElement(
      'div',
      { 'data-testid': 'directory-selected-entries' },
      props.entries.map((entry) => entry.name).join(' | '),
    ),
}));

vi.mock('../../src/components/participants/participant-results', () => ({
  ParticipantResults: (props: { selectedEventId?: string }) => {
    if (props.selectedEventId === eventPrimeiroId) {
      return createElement('div', { 'data-testid': 'directory-selected-entries' }, NOME_PESSOA_PRIMEIRO);
    }
    if (props.selectedEventId === eventSegundoId) {
      return createElement('div', { 'data-testid': 'directory-selected-entries' }, NOME_PESSOA_SEGUNDO);
    }
    return createElement(
      'div',
      { 'data-testid': 'directory-selected-entries' },
      `${NOME_PESSOA_PRIMEIRO} | ${NOME_PESSOA_SEGUNDO}`,
    );
  },
}));

vi.mock('../../src/components/exports/export-panel', () => ({
  ExportPanel: () => null,
}));

const { default: CheckinPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/credenciamento/page'
);
const { default: BadgesPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/credenciamento/crachas/page'
);
const { default: OwnBadgePage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/meu-cracha/page'
);
const { default: OwnAgendaPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/minha-agenda/page'
);
const { default: ParticipantsPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/participantes/page'
);

let tenantId: string;
let userId: string;
let pessoaSegundoId: string;
let eventPrimeiroId: string;
let eventSegundoId: string;

async function renderizar(
  pagina: (props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string | undefined>>;
  }) => Promise<unknown>,
  searchParams: Record<string, string | undefined> = {},
): Promise<string> {
  const elemento = (await pagina({
    params: Promise.resolve({ tenantSlug: TENANT_SLUG }),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;

  return renderToStaticMarkup(elemento);
}

beforeAll(async () => {
  tenantId = randomUUID();
  userId = randomUUID();
  pessoaSegundoId = randomUUID();
  eventPrimeiroId = randomUUID();
  eventSegundoId = randomUUID();

  contextoMock.tenantId = tenantId;
  contextoMock.tenantSlug = TENANT_SLUG;
  contextoMock.tenantName = `Instituição da F89 ${RUN}`;
  contextoMock.userId = userId;
  contextoMock.userName = NOME_PESSOA_PRIMEIRO;
  contextoMock.userEmail = `f89.primeiro.${RUN}@exemplo.test`;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: contextoMock.tenantName,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await adminPrisma.user.createMany({
    data: [
      {
        id: userId,
        name: NOME_PESSOA_PRIMEIRO,
        email: contextoMock.userEmail,
        emailVerified: true,
      },
      {
        id: pessoaSegundoId,
        name: NOME_PESSOA_SEGUNDO,
        email: `f89.segundo.${RUN}@exemplo.test`,
        emailVerified: true,
      },
    ],
  });

  await adminPrisma.userTenantProfile.createMany({
    data: [
      {
        id: randomUUID(),
        tenantId,
        userId,
        status: 'ACTIVE',
        kind: 'MEMBER',
        joinedAt: new Date(),
      },
      {
        id: randomUUID(),
        tenantId,
        userId: pessoaSegundoId,
        status: 'ACTIVE',
        kind: 'PARTICIPANT',
        joinedAt: new Date(),
      },
    ],
  });

  /**
   * As 4 telas com `fallback: 'first'` ordenam `startsAt: 'desc'`. Então o
   * `eventPrimeiroId` tem `startsAt` MAIS RECENTE no futuro (+60 dias) para ser
   * deterministicamente o índice 0 (`events[0]`), e `eventSegundoId` tem +30 dias.
   */
  const startsPrimeiro = new Date(Date.now() + 60 * 86_400_000);
  const startsSegundo = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.createMany({
      data: [
        {
          id: eventPrimeiroId,
          tenantId,
          slug: `congresso-primeiro-f89-${RUN}`,
          title: TITULO_PRIMEIRO,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt: startsPrimeiro,
          endsAt: new Date(startsPrimeiro.getTime() + 86_400_000),
          capacity: null,
          confirmedCount: 1,
        },
        {
          id: eventSegundoId,
          tenantId,
          slug: `simposio-segundo-f89-${RUN}`,
          title: TITULO_SEGUNDO,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt: startsSegundo,
          endsAt: new Date(startsSegundo.getTime() + 86_400_000),
          capacity: null,
          confirmedCount: 2,
        },
      ],
    });

    const activityPrimeiroId = randomUUID();
    const activitySegundoId = randomUUID();

    await tx.activity.createMany({
      data: [
        {
          id: activityPrimeiroId,
          tenantId,
          eventId: eventPrimeiroId,
          slug: `palestra-primeiro-${RUN}`,
          title: `Palestra Primeiro ${RUN}`,
          type: 'LECTURE',
          startsAt: startsPrimeiro,
          endsAt: new Date(startsPrimeiro.getTime() + 3_600_000),
          workloadMinutes: 60,
        },
        {
          id: activitySegundoId,
          tenantId,
          eventId: eventSegundoId,
          slug: `palestra-segundo-${RUN}`,
          title: `Palestra Segundo ${RUN}`,
          type: 'LECTURE',
          startsAt: startsSegundo,
          endsAt: new Date(startsSegundo.getTime() + 3_600_000),
          workloadMinutes: 60,
        },
      ],
    });

    await tx.registration.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          eventId: eventPrimeiroId,
          activityId: activityPrimeiroId,
          userId,
          status: 'CONFIRMED',
        },
        {
          id: randomUUID(),
          tenantId,
          eventId: eventSegundoId,
          activityId: activitySegundoId,
          userId,
          status: 'CONFIRMED',
        },
        {
          id: randomUUID(),
          tenantId,
          eventId: eventSegundoId,
          activityId: activitySegundoId,
          userId: pessoaSegundoId,
          status: 'CONFIRMED',
        },
      ],
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: { in: [userId, pessoaSegundoId] } } });
  await adminPrisma.$disconnect();
});

describe('E89 — as 4 telas de evento (fallback: first) anunciam ?evento= descartado', () => {
  it('/credenciamento: malformado e UUID ausente caem no 1º evento COM aviso; UUID válido seleciona sem aviso', async () => {
    const htmlMalformado = await renderizar(CheckinPage, { evento: UUID_MALFORMADO });
    expect(htmlMalformado).toContain('data-testid="checkin-event-notice"');
    expect(htmlMalformado).toContain(
      discardedEventSelectionNotice({
        fallback: 'first',
        fallbackEventTitle: TITULO_PRIMEIRO,
        reason: 'invalid_format',
      }).replaceAll('"', '&quot;'),
    );
    expect(htmlMalformado).toContain(`${eventPrimeiroId}:${TITULO_PRIMEIRO}`);

    const htmlAusente = await renderizar(CheckinPage, { evento: UUID_AUSENTE });
    expect(htmlAusente).toContain('data-testid="checkin-event-notice"');
    expect(htmlAusente).toContain(
      discardedEventSelectionNotice({
        fallback: 'first',
        fallbackEventTitle: TITULO_PRIMEIRO,
        reason: 'not_found',
      }).replaceAll('"', '&quot;'),
    );
    expect(htmlAusente).toContain(`${eventPrimeiroId}:${TITULO_PRIMEIRO}`);

    const htmlValido = await renderizar(CheckinPage, { evento: eventSegundoId });
    expect(htmlValido).not.toContain('data-testid="checkin-event-notice"');
    expect(htmlValido).toContain(`${eventSegundoId}:${TITULO_SEGUNDO}`);
  });

  it('/credenciamento/crachas: malformado e UUID ausente caem no 1º evento COM aviso; UUID válido seleciona sem aviso', async () => {
    const htmlMalformado = await renderizar(BadgesPage, { evento: UUID_MALFORMADO });
    expect(htmlMalformado).toContain('data-testid="badge-event-notice"');
    expect(htmlMalformado).toContain(`data-testid="roster-selected-event">${eventPrimeiroId}</div>`);

    const htmlAusente = await renderizar(BadgesPage, { evento: UUID_AUSENTE });
    expect(htmlAusente).toContain('data-testid="badge-event-notice"');
    expect(htmlAusente).toContain(`data-testid="roster-selected-event">${eventPrimeiroId}</div>`);

    const htmlValido = await renderizar(BadgesPage, { evento: eventSegundoId });
    expect(htmlValido).not.toContain('data-testid="badge-event-notice"');
    expect(htmlValido).toContain(`data-testid="roster-selected-event">${eventSegundoId}</div>`);
  });

  it('/meu-cracha: malformado e UUID ausente caem no 1º evento COM aviso; UUID válido seleciona sem aviso', async () => {
    const htmlMalformado = await renderizar(OwnBadgePage, { evento: UUID_MALFORMADO });
    expect(htmlMalformado).toContain('data-testid="own-badge-event-notice"');
    expect(htmlMalformado).toContain(`${eventPrimeiroId}:${TITULO_PRIMEIRO}`);

    const htmlAusente = await renderizar(OwnBadgePage, { evento: UUID_AUSENTE });
    expect(htmlAusente).toContain('data-testid="own-badge-event-notice"');
    expect(htmlAusente).toContain(`${eventPrimeiroId}:${TITULO_PRIMEIRO}`);

    const htmlValido = await renderizar(OwnBadgePage, { evento: eventSegundoId });
    expect(htmlValido).not.toContain('data-testid="own-badge-event-notice"');
    expect(htmlValido).toContain(`${eventSegundoId}:${TITULO_SEGUNDO}`);
  });

  it('/minha-agenda: malformado e UUID ausente caem no 1º evento COM aviso; UUID válido seleciona sem aviso', async () => {
    const htmlMalformado = await renderizar(OwnAgendaPage, { evento: UUID_MALFORMADO });
    expect(htmlMalformado).toContain('data-testid="agenda-event-notice"');
    expect(htmlMalformado).toContain(`value="${eventPrimeiroId}" selected=""`);

    const htmlAusente = await renderizar(OwnAgendaPage, { evento: UUID_AUSENTE });
    expect(htmlAusente).toContain('data-testid="agenda-event-notice"');
    expect(htmlAusente).toContain(`value="${eventPrimeiroId}" selected=""`);

    const htmlValido = await renderizar(OwnAgendaPage, { evento: eventSegundoId });
    expect(htmlValido).not.toContain('data-testid="agenda-event-notice"');
    expect(htmlValido).toContain(`value="${eventSegundoId}" selected=""`);
  });
});

describe('E89 — /participantes (fallback: all) anuncia ?evento= descartado e mostra todos', () => {
  it('malformado e UUID ausente mostram os participantes de todos os eventos COM aviso; UUID válido filtra sem aviso', async () => {
    const htmlMalformado = await renderizar(ParticipantsPage, { evento: UUID_MALFORMADO });
    expect(htmlMalformado).toContain('data-testid="participant-event-notice"');
    expect(htmlMalformado).toContain(discardedFilterNotice('evento'));
    expect(htmlMalformado).toContain(NOME_PESSOA_PRIMEIRO);
    expect(htmlMalformado).toContain(NOME_PESSOA_SEGUNDO);

    const htmlAusente = await renderizar(ParticipantsPage, { evento: UUID_AUSENTE });
    expect(htmlAusente).toContain('data-testid="participant-event-notice"');
    expect(htmlAusente).toContain(
      discardedEventSelectionNotice({
        fallback: 'all',
        reason: 'not_found',
      }),
    );
    expect(htmlAusente).toContain(NOME_PESSOA_PRIMEIRO);
    expect(htmlAusente).toContain(NOME_PESSOA_SEGUNDO);

    const htmlValido = await renderizar(ParticipantsPage, { evento: eventPrimeiroId });
    expect(htmlValido).not.toContain('data-testid="participant-event-notice"');
    expect(htmlValido).toContain(NOME_PESSOA_PRIMEIRO);
    expect(htmlValido).not.toContain(NOME_PESSOA_SEGUNDO);
  });
});
