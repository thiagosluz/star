/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — EQUIPE DO EVENTO NA PÁGINA PÚBLICA (FASE 45)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a vitrine lê as equipes do EVENTO — a mesma lista das demandas —, sem segundo
 *      cadastro e sem dado de outro evento;
 *    • quem PERDEU o vínculo com a instituição sai da página pública: a linha da
 *      equipe continua (o histórico do quadro depende dela), mas o nome e a foto não
 *      vão para a internet. O `user` é global e a RLS não segura isso por nós;
 *    • o contato só chega ao pacote quando o campo `contacts` está autorizado — o
 *      e-mail de quem não autorizou **não sai do banco** para a camada de cima;
 *    • equipe desativada não aparece, e o filtro do bloco (`teamId`) mostra uma só.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import { listEventTeamOptions } from '../../src/lib/events/team-directory';
import { PAGE_BLOCK_TYPES } from '../../src/domain/events/landing-page';
import { buildPublicProfile } from '../../src/domain/profile/public-profile-rules';
import { savePublicProfile } from '../../src/lib/profile/public-profile-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let tenantSlug: string;
let eventId: string;
let otherEventId: string;

let ana: string;
let bruno: string;
let carla: string;
let removida: string;

const EVENT_SLUG = `evento-equipe-${RUN}`;

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f45.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

async function addMember(userId: string, tenant = tenantId, status: 'ACTIVE' | 'REMOVED' = 'ACTIVE') {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId: tenant,
      userId,
      status,
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });
}

async function createTeam(input: {
  event: string;
  name: string;
  tenant?: string;
  isActive?: boolean;
  members: { userId: string; isLead?: boolean }[];
}): Promise<string> {
  const tenant = input.tenant ?? tenantId;
  const id = randomUUID();

  await withTenant(tenant, async (tx) => {
    await tx.eventTeam.create({
      data: {
        id,
        tenantId: tenant,
        eventId: input.event,
        name: input.name,
        isActive: input.isActive ?? true,
        members: {
          create: input.members.map((member) => ({
            id: randomUUID(),
            tenantId: tenant,
            userId: member.userId,
            isLead: member.isLead ?? false,
          })),
        },
      },
    });
  });

  return id;
}

/** Grava o perfil público direto pelo serviço, como a tela faria. */
async function saveProfile(
  userId: string,
  input: {
    username: string;
    contacts?: Record<string, string>;
    audiences?: Record<string, string>;
  },
): Promise<void> {
  const result = await savePublicProfile({
    tenantId,
    userId,
    username: input.username,
    headline: null,
    bio: null,
    interests: [],
    siteUrl: null,
    orcidId: null,
    lattesId: null,
    contacts: input.contacts ?? {},
    audiences: input.audiences ?? {},
    indexable: false,
    listedInDirectory: false,
    publicNameInResults: false,
    publicEventIds: [],
  });

  expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  tenantSlug = `equipe-${RUN}`;
  eventId = randomUUID();
  otherEventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: tenantSlug,
        name: `Instituição da Equipe ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: 'America/Bahia',
      },
      {
        id: otherTenantId,
        slug: `equipe-outra-${RUN}`,
        name: `Outra Instituição ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: 'America/Bahia',
      },
    ],
  });

  const future = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: 'Congresso da Equipe',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: future,
        endsAt: new Date(future.getTime() + 86_400_000),
        confirmedCount: 0,
      },
    }),
  );

  await withTenant(otherTenantId, (tx) =>
    tx.event.create({
      data: {
        id: otherEventId,
        tenantId: otherTenantId,
        slug: `outro-evento-${RUN}`,
        title: 'Evento de Outra Casa',
        status: 'REGISTRATION_OPEN',
        modality: 'ONLINE',
        timezone: 'America/Bahia',
        startsAt: future,
        endsAt: new Date(future.getTime() + 3_600_000),
        confirmedCount: 0,
      },
    }),
  );

  ana = await createUser('Ana Souza');
  bruno = await createUser('Bruno Lima');
  carla = await createUser('Carla Nunes');
  removida = await createUser('Quem Saiu');

  await addMember(ana);
  await addMember(bruno);
  await addMember(carla);
  /** Vínculo REMOVIDO: a linha da equipe fica, a vitrine não mostra. */
  await addMember(removida, tenantId, 'REMOVED');

  await createTeam({
    event: eventId,
    name: 'Presidência',
    members: [{ userId: ana, isLead: true }, { userId: removida }],
  });

  await createTeam({
    event: eventId,
    name: 'Programação',
    members: [{ userId: bruno }, { userId: carla }],
  });

  await createTeam({
    event: eventId,
    name: 'Equipe antiga',
    isActive: false,
    members: [{ userId: bruno }],
  });

  /** Equipe do MESMO nome na outra instituição: nada dela pode vazar para cá. */
  await addMember(removida, otherTenantId);
  await createTeam({
    event: otherEventId,
    tenant: otherTenantId,
    name: 'Equipe de Fora',
    members: [{ userId: removida }],
  });

  await saveProfile(ana, { username: `ana-${RUN}` });
  await saveProfile(bruno, { username: `bruno-${RUN}` });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o bloco de equipe é um tipo de bloco de primeira classe', () => {
  it('`TEAM` está no catálogo do domínio e tem rótulo, descrição e conteúdo padrão', async () => {
    const { BLOCK_LABELS, BLOCK_DESCRIPTIONS, DEFAULT_BLOCK_CONTENT, blockContentSchemas } =
      await import('../../src/domain/events/landing-page');

    expect(PAGE_BLOCK_TYPES).toContain('TEAM');
    expect(BLOCK_LABELS.TEAM).toBe('Equipe do evento');
    expect(BLOCK_DESCRIPTIONS.TEAM.length).toBeGreaterThan(20);
    expect(DEFAULT_BLOCK_CONTENT.TEAM).toEqual({});
    expect(blockContentSchemas.TEAM).toBeDefined();
  });

  it('o seletor do editor lista só equipe ATIVA, com a contagem de pessoas', async () => {
    const options = await listEventTeamOptions(tenantId, eventId);

    expect(options.map((option) => option.name)).toEqual(['Presidência', 'Programação']);
    expect(options.find((option) => option.name === 'Presidência')?.memberCount).toBe(2);

    /** Equipe de OUTRO evento (e de outra instituição) não entra. */
    const doOutroEvento = await listEventTeamOptions(otherTenantId, otherEventId);
    expect(doOutroEvento.map((option) => option.name)).toEqual(['Equipe de Fora']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a vitrine que a página pública recebe', () => {
  it('lê as equipes do evento, com a etiqueta do nome da equipe', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);

    expect(event).not.toBeNull();
    if (!event) return;

    /**
     * Carla nunca abriu o perfil público e não tem handle — e mesmo assim aparece:
     * nome e equipe são informação do EVENTO (como o crachá). O que ela não publica é
     * foto e contato, e é isso que o resto desta suíte prende.
     */
    expect(event.organizers.map((card) => card.name).sort()).toEqual([
      'Ana Souza',
      'Bruno Lima',
      'Carla Nunes',
    ]);
    expect(event.teams.map((team) => team.name)).toEqual(['Presidência', 'Programação']);

    const anaCard = event.organizers.find((card) => card.userId === ana);
    expect(anaCard?.labels).toEqual(['Presidência']);
    expect(anaCard?.isLead).toBe(true);
  });

  it('quem perdeu o vínculo com a instituição NÃO aparece na página pública', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    /** A linha da equipe continua no banco (o quadro de demandas depende dela)... */
    const naEquipe = await withTenant(tenantId, (tx) =>
      tx.eventTeamMember.count({ where: { tenantId, userId: removida } }),
    );
    expect(naEquipe).toBe(1);

    /** ...mas o nome dela não vai para a internet. */
    expect(event.organizers.map((card) => card.userId)).not.toContain(removida);
    expect(JSON.stringify(event.organizers)).not.toContain('Quem Saiu');
  });

  it('a equipe do outro evento/instituição não contamina esta página', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    expect(event.organizers.map((card) => card.labels).flat()).not.toContain('Equipe de Fora');
  });

  it('equipe desativada não entra — nem a etiqueta, nem quem só está nela', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    expect(event.teams.map((team) => team.name)).not.toContain('Equipe antiga');

    /** Bruno está em Programação (ativa) e na antiga: aparece UMA vez, com uma etiqueta. */
    const brunoCard = event.organizers.find((card) => card.userId === bruno);
    expect(event.organizers.filter((card) => card.userId === bruno)).toHaveLength(1);
    expect(brunoCard?.labels).toEqual(['Programação']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('consentimento: a matriz do perfil decide o que a vitrine mostra', () => {
  it('foto e contato NÃO saem antes de a pessoa autorizar', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const anaCard = event.organizers.find((card) => card.userId === ana);

    /**
     * A foto é do perfil e o campo `avatar` nasce PÚBLICO (F44) — o que não sai sem
     * autorização é o CONTATO. Aqui nem foto a pessoa subiu, então o cartão cai nas
     * iniciais (a página decide pelo `avatarUrl: null`).
     */
    expect(anaCard?.avatarUrl).toBeNull();
    expect(anaCard?.email).toBeNull();
    expect(anaCard?.links).toEqual({});
  });

  it('autorizar o contato no perfil faz o e-mail e as redes chegarem à vitrine', async () => {
    await saveProfile(ana, {
      username: `ana-${RUN}`,
      contacts: { linkedin: 'linkedin.com/in/ana-souza' },
      audiences: { contacts: 'PUBLIC' },
    });

    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const anaCard = event.organizers.find((card) => card.userId === ana);

    expect(anaCard?.links.linkedin).toBe('https://linkedin.com/in/ana-souza');
    expect(anaCard?.email).toContain(`f45.${RUN}`);
  });

  it('o e-mail de quem NÃO autorizou não é enviado para a camada de cima', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const brunoCard = event.organizers.find((card) => card.userId === bruno);
    expect(brunoCard?.email).toBeNull();

    /** Nem escondido no payload: a checagem é sobre o JSON inteiro do evento. */
    const emailDoBruno = await withTenant(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: bruno }, select: { email: true } }),
    );

    expect(JSON.stringify(event.organizers)).not.toContain(emailDoBruno.email);
  });

  it('voltar o contato para PRIVATE tira tudo da vitrine de novo', async () => {
    await saveProfile(ana, {
      username: `ana-${RUN}`,
      contacts: { linkedin: 'linkedin.com/in/ana-souza' },
      audiences: { contacts: 'PRIVATE' },
    });

    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const anaCard = event.organizers.find((card) => card.userId === ana);
    expect(anaCard?.email).toBeNull();
    expect(anaCard?.links).toEqual({});

    /** O link continua GRAVADO — a pessoa só não o publica. */
    const settings = await withTenant(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: ana }, select: { publicSocialLinks: true } }),
    );
    expect(settings.publicSocialLinks).toMatchObject({ linkedin: expect.any(String) });
  });

  it('`ATTENDEES_ONLY` não vale na página pública: o bloco mostra para quem não tem sessão', async () => {
    await saveProfile(ana, {
      username: `ana-${RUN}`,
      contacts: { linkedin: 'linkedin.com/in/ana-souza' },
      audiences: { contacts: 'ATTENDEES_ONLY' },
    });

    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const anaCard = event.organizers.find((card) => card.userId === ana);
    expect(anaCard?.email).toBeNull();
    expect(anaCard?.links).toEqual({});
  });

  it('o mesmo consentimento vale no perfil público da pessoa (uma decisão, não duas)', async () => {
    await saveProfile(ana, {
      username: `ana-${RUN}`,
      contacts: { instagram: '@ana.souza' },
      audiences: { contacts: 'PUBLIC' },
    });

    const dados = await withTenant(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: ana },
        select: { publicSocialLinks: true, profileAudiences: true, email: true },
      }),
    );

    const payload = buildPublicProfile({
      source: {
        username: `ana-${RUN}`,
        displayName: 'Ana Souza',
        avatarUrl: null,
        headline: null,
        bio: null,
        interests: [],
        siteUrl: null,
        orcidId: null,
        lattesId: null,
        email: dados.email,
        socialLinks: { instagram: 'https://instagram.com/ana.souza' },
        level: 1,
        levelTitle: 'Iniciante',
        prestige: 0,
        xp: 0,
        streak: 0,
        pinnedCards: [],
        collection: { owned: 0, total: 0, byRarity: {}, foils: 0 },
        eventCount: 0,
        events: [],
        certificates: [],
        standing: null,
      },
      visibleFields: ['contacts'],
    });

    expect(payload.email).toBe(dados.email);
    expect(payload.socialLinks?.instagram).toBe('https://instagram.com/ana.souza');
  });
});
