/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — PERFIL PÚBLICO DO PARTICIPANTE (FASE 44)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • o `@handle` é GLOBAL e único sem diferenciar maiúscula — o índice parcial
 *      `lower("publicHandle")` é a palavra final, e a espera de 30 dias só vale para
 *      troca de verdade (salvar o mesmo handle não consome a espera);
 *    • o `user` é GLOBAL e a RLS NÃO o protege: por isso a página só existe na
 *      instituição onde a pessoa tem vínculo — este é o teste que prova que o handle
 *      não vira janela para dentro de uma casa onde a pessoa nunca esteve;
 *    • a visibilidade é POR CAMPO e POR VISITANTE, e o pacote que sai do servidor não
 *      traz a chave do que foi negado;
 *    • perfil todo privado responde 404 (nunca "existe, mas você não pode ver");
 *    • o diretório e a lista de eventos são POR INSTITUIÇÃO (`user_tenant_profile`),
 *      enquanto a decisão de visibilidade é uma só (`user`);
 *    • consentir não paga XP, e a trilha guarda a DECISÃO (campos divulgados), nunca o
 *      conteúdo (a bio não é copiada para a auditoria);
 *    • a posição relativa ("top N%") sai na direção certa — o defeito estava aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listAuditLog } from '../../src/lib/admin/audit';
import {
  getPublicProfile,
  getPublicProfileSettings,
  listDirectoryProfiles,
  publicProfilePath,
  savePublicProfile,
} from '../../src/lib/profile/public-profile-service';
import { DEFAULT_PROFILE_AUDIENCES } from '../../src/domain/profile/public-profile-rules';

const RUN = randomUUID().slice(0, 8);

const EVENT_2025_START = new Date('2025-03-10T12:00:00.000Z');
const EVENT_2027_START = new Date('2027-05-20T12:00:00.000Z');

let tenantA: string;
let tenantB: string;
let slugA: string;
let slugB: string;
let eventA2025: string;
let eventA2027: string;
let eventB: string;

let ana: string;
let bruno: string;
let elisa: string;
let carla: string;
let duda: string;

const HANDLE_ANA = `ana-${RUN}`;
const HANDLE_DUDA = `duda-${RUN}`;

const BIO_ANA = 'Trabalho com vigilância epidemiológica e dados abertos de saúde.';
const HEADLINE_ANA = 'Pesquisadora em saúde pública';

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f44.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

async function addMember(userId: string, tenantId: string): Promise<void> {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status: 'ACTIVE',
      kind: 'PARTICIPANT',
      joinedAt: new Date(),
    },
  });
}

async function seedXp(userId: string, tenantId: string, totalXp: number, level: number): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.userXpProfile.create({
      data: { id: randomUUID(), tenantId, userId, totalXp, level },
    }),
  );
}

async function registerConfirmed(userId: string, tenantId: string, eventId: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        userId,
        status: 'CONFIRMED',
        consentData: true,
        checkedInAt: EVENT_2025_START,
      },
    }),
  );
}

async function totalXp(tenantId: string, userId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const profile = await tx.userXpProfile.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { totalXp: true },
    });

    return profile?.totalXp ?? 0;
  });
}

async function xpFactCount(tenantId: string, userId: string): Promise<number> {
  return withTenant(tenantId, (tx) => tx.xpTransaction.count({ where: { tenantId, userId } }));
}

async function profileAudit(tenantId: string, action: string) {
  const entries = await listAuditLog(tenantId, { limit: 200 });

  return entries.filter(
    (entry) => entry.entityType === 'user_public_profile' && entry.action === action,
  );
}

/**
 * A matriz de visibilidade com todos os campos no mesmo nível — o jeito curto de
 * montar os cenários ("tudo público", "tudo privado", "só para a casa").
 */
function matrix(value: 'PUBLIC' | 'ATTENDEES_ONLY' | 'PRIVATE'): Record<string, string> {
  return Object.fromEntries(Object.keys(DEFAULT_PROFILE_AUDIENCES).map((field) => [field, value]));
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantA = randomUUID();
  tenantB = randomUUID();
  slugA = `perfil-a-${RUN}`;
  slugB = `perfil-b-${RUN}`;
  eventA2025 = randomUUID();
  eventA2027 = randomUUID();
  eventB = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      { id: tenantA, slug: slugA, name: `Instituição A ${RUN}`, status: 'ACTIVE', plan: 'FREE', timezone: 'America/Bahia' },
      { id: tenantB, slug: slugB, name: `Instituição B ${RUN}`, status: 'ACTIVE', plan: 'FREE', timezone: 'America/Bahia' },
    ],
  });

  await withTenant(tenantA, (tx) =>
    tx.event.createMany({
      data: [
        {
          id: eventA2025,
          tenantId: tenantA,
          slug: `encontro-2025-${RUN}`,
          title: 'Encontro de 2025',
          status: 'FINISHED',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt: EVENT_2025_START,
          endsAt: new Date(EVENT_2025_START.getTime() + 86_400_000),
          confirmedCount: 0,
        },
        {
          id: eventA2027,
          tenantId: tenantA,
          slug: `encontro-2027-${RUN}`,
          title: 'Encontro de 2027',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt: EVENT_2027_START,
          endsAt: new Date(EVENT_2027_START.getTime() + 86_400_000),
          confirmedCount: 0,
        },
      ],
    }),
  );

  await withTenant(tenantB, (tx) =>
    tx.event.create({
      data: {
        id: eventB,
        tenantId: tenantB,
        slug: `encontro-b-${RUN}`,
        title: 'Encontro da Instituição B',
        status: 'REGISTRATION_OPEN',
        modality: 'ONLINE',
        timezone: 'America/Bahia',
        startsAt: EVENT_2027_START,
        endsAt: new Date(EVENT_2027_START.getTime() + 3_600_000),
        confirmedCount: 0,
      },
    }),
  );

  ana = await createUser('Ana Souza');
  bruno = await createUser('Bruno Lima');
  elisa = await createUser('Elisa Prado');
  carla = await createUser('Carla Nunes');
  duda = await createUser('Duda Reis');

  await addMember(ana, tenantA);
  await addMember(bruno, tenantA);
  await addMember(elisa, tenantA);
  /** Carla existe na plataforma e NÃO tem vínculo com a instituição A. */
  await addMember(carla, tenantB);
  await addMember(duda, tenantB);

  await seedXp(ana, tenantA, 400, 5);
  await seedXp(bruno, tenantA, 100, 2);
  await seedXp(elisa, tenantA, 50, 1);
  await seedXp(carla, tenantB, 10, 1);
  await seedXp(duda, tenantB, 700, 8);

  await registerConfirmed(ana, tenantA, eventA2025);
  await registerConfirmed(ana, tenantA, eventA2027);

  /** Uma carta fixada e um certificado emitido, para as seções de conquista. */
  const cardTemplateId = randomUUID();

  await withTenant(tenantA, async (tx) => {
    await tx.cardTemplate.create({
      data: {
        id: cardTemplateId,
        tenantId: tenantA,
        slug: `guardiao-${RUN}`,
        name: 'Guardião do Método',
        rarity: 'RARE',
        trigger: 'MANUAL_GRANT',
      },
    });

    await tx.userCard.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        userId: ana,
        cardTemplateId,
        isPinned: true,
        isFoil: true,
        source: 'MANUAL_GRANT',
      },
    });

    await tx.certificate.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        eventId: eventA2025,
        userId: ana,
        kind: 'PARTICIPATION',
        status: 'ISSUED',
        validationCode: `CERT-${RUN}`,
        title: 'Certificado de participação',
        recipientName: 'Ana Souza',
        bodyText: 'Participou do Encontro de 2025.',
        workloadMinutes: 480,
        issuedAt: EVENT_2025_START,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('@handle', () => {
  it('normaliza na gravação e o endereço sai em minúsculas', async () => {
    const saved = await savePublicProfile({
      tenantId: tenantA,
      userId: ana,
      username: `  Ana-${RUN.toUpperCase()}  `,
      headline: HEADLINE_ANA,
      bio: BIO_ANA,
      interests: ['Saúde pública', 'Dados abertos'],
      siteUrl: 'https://ana.test',
      orcidId: '0000-0002-1825-0097',
      lattesId: '1234.5678.9012.3456',
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [eventA2025, eventB],
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);
    if (!saved.ok) return;

    expect(saved.username).toBe(HANDLE_ANA);
    expect(saved.handleChanged).toBe(true);

    const settings = await getPublicProfileSettings({ tenantId: tenantA, userId: ana });
    expect(settings.ok).toBe(true);
    if (!settings.ok) return;

    expect(settings.settings.username).toBe(HANDLE_ANA);
    expect(settings.settings.audiences).toEqual(DEFAULT_PROFILE_AUDIENCES);
    expect(settings.settings.publicNameInResults).toBe(false);
    expect(settings.settings.interests).toEqual(['Saúde pública', 'Dados abertos']);
    expect(settings.settings.orcidId).toBe('0000-0002-1825-0097');
    expect(settings.settings.lattesId).toBe('1234567890123456');

    /** O evento da OUTRA instituição é descartado: não existe participação lá. */
    expect(settings.settings.publicEventIds).toEqual([eventA2025]);
    expect(settings.settings.eventOptions.map((option) => option.id).sort()).toEqual(
      [eventA2025, eventA2027].sort(),
    );

    expect(publicProfilePath(slugA, HANDLE_ANA)).toBe(`/t/${slugA}/u/${HANDLE_ANA}`);
  });

  it('recusa handle reservado e handle já usado (sem diferenciar maiúscula)', async () => {
    const reservado = await savePublicProfile({
      tenantId: tenantA,
      userId: bruno,
      username: 'admin',
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(reservado.ok).toBe(false);
    if (!reservado.ok) expect(reservado.code).toBe('INVALID_INPUT');

    /** `ANA-<RUN>` é o MESMO handle de ana: o índice é sobre `lower("publicHandle")`. */
    const duplicado = await savePublicProfile({
      tenantId: tenantA,
      userId: bruno,
      username: `ANA-${RUN.toUpperCase()}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(duplicado.ok).toBe(false);
    if (!duplicado.ok) {
      expect(duplicado.code).toBe('USERNAME_TAKEN');
      expect(duplicado.message).toContain(HANDLE_ANA);
    }
  });

  it('a espera de 30 dias vale para TROCA, e salvar o mesmo handle não a consome', async () => {
    const primeiro = await savePublicProfile({
      tenantId: tenantA,
      userId: bruno,
      username: `bruno-${RUN}`,
      headline: 'Coordenador de laboratório',
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(primeiro.ok, primeiro.ok ? 'ok' : primeiro.message).toBe(true);

    /** Salvar de novo sem mexer no campo é livre — não pode queimar a espera. */
    const mesmo = await savePublicProfile({
      tenantId: tenantA,
      userId: bruno,
      username: `bruno-${RUN}`,
      headline: 'Coordenador de laboratório sênior',
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(mesmo.ok, mesmo.ok ? 'ok' : mesmo.message).toBe(true);
    if (mesmo.ok) expect(mesmo.handleChanged).toBe(false);

    const troca = await savePublicProfile({
      tenantId: tenantA,
      userId: bruno,
      username: `bruno-2-${RUN}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(troca.ok).toBe(false);
    if (!troca.ok) {
      expect(troca.code).toBe('USERNAME_COOLDOWN');
      expect(troca.details?.[0]).toContain('Próxima troca');
    }

    /** Trinta e um dias depois, a troca passa. */
    const depois = await savePublicProfile({
      tenantId: tenantA,
      userId: bruno,
      username: `bruno-2-${RUN}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
      now: new Date(Date.now() + 31 * 86_400_000),
    });

    expect(depois.ok, depois.ok ? 'ok' : depois.message).toBe(true);
    if (depois.ok) {
      expect(depois.username).toBe(`bruno-2-${RUN}`);
      expect(depois.handleChanged).toBe(true);
    }
  });

  it('site sem http(s) e identificador acadêmico inválido são RECUSADOS, não descartados', async () => {
    const site = await savePublicProfile({
      tenantId: tenantA,
      userId: elisa,
      username: `elisa-${RUN}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: 'javascript:alert(1)',
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(site.ok).toBe(false);
    if (!site.ok) expect(site.message).toContain('http://');

    const orcid = await savePublicProfile({
      tenantId: tenantA,
      userId: elisa,
      username: `elisa-${RUN}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: '000000218250097',
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(orcid.ok).toBe(false);
    if (!orcid.ok) expect(orcid.message).toContain('0000-0000-0000-0000');

    /** Nada disso gravou: o handle de elisa continua livre para a próxima tentativa. */
    const settings = await getPublicProfileSettings({ tenantId: tenantA, userId: elisa });
    expect(settings.ok).toBe(true);
    if (settings.ok) expect(settings.settings.username).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o que cada visitante enxerga', () => {
  it('o anônimo vê a identidade e o nível, e NÃO vê XP, eventos nem coleção', async () => {
    const result = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: null,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.page.viewer).toBe('ANONYMOUS');
    expect(result.page.isOwner).toBe(false);
    expect(result.page.moreForAttendees).toBe(true);
    expect(result.page.indexable).toBe(false);

    const profile = result.page.profile;

    expect(profile.username).toBe(HANDLE_ANA);
    expect(profile.displayName).toBe('Ana Souza');
    expect(profile.headline).toBe(HEADLINE_ANA);
    expect(profile.level).toBe(5);
    expect(profile.eventCount).toBe(2);
    expect(profile.certificates?.[0]?.workloadLabel).toBe('8 h');

    /**
     * A carta FIXADA sai para o anônimo: fixar é um ato explícito de destaque (o campo
     * nasceu para isso no modelo). O que não sai é o álbum.
     */
    expect(profile.pinnedCards).toEqual([
      { name: 'Guardião do Método', rarity: 'RARE', imageUrl: null, isFoil: true },
    ]);

    /** O que é da casa NÃO sai — nem a chave. */
    expect(profile.xp).toBeUndefined();
    expect(profile.events).toBeUndefined();
    expect(profile.collection).toBeUndefined();
    expect(profile.standing).toBeUndefined();
  });

  it('quem PARTICIPA da instituição vê XP, eventos escolhidos, coleção e posição', async () => {
    const result = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: bruno,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.page.viewer).toBe('AUDIENCE');
    expect(result.page.moreForAttendees).toBe(false);

    const profile = result.page.profile;

    expect(profile.xp).toBe(400);
    expect(profile.streak).toBe(0);
    expect(profile.collection).toEqual({ owned: 1, total: 1, byRarity: { RARE: 1 }, foils: 1 });
    expect(profile.pinnedCards).toEqual([
      { name: 'Guardião do Método', rarity: 'RARE', imageUrl: null, isFoil: true },
    ]);

    /** Só o evento ESCOLHIDO entra — o outro conta no número, mas não aparece. */
    expect(profile.events).toEqual([{ title: 'Encontro de 2025', year: 2025 }]);
    expect(profile.eventCount).toBe(2);
  });

  it('estar logado NÃO é ser da casa: a visitante sem vínculo vê o mesmo que o anônimo', async () => {
    const result = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: carla,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    /** Carla é membro da instituição B, não da A. */
    expect(result.page.viewer).toBe('ANONYMOUS');
    expect(result.page.profile.xp).toBeUndefined();
    expect(result.page.profile.events).toBeUndefined();
  });

  it('a matriz é respeitada campo a campo: só o nível autorizado sai', async () => {
    const pessoa = await createUser('Matriz Campo a Campo F44');
    await addMember(pessoa, tenantA);

    const saved = await savePublicProfile({
      tenantId: tenantA,
      userId: pessoa,
      username: `matriz-${RUN}`,
      headline: 'Só o título',
      bio: 'Esta bio NÃO pode sair.',
      interests: ['Privacidade'],
      siteUrl: 'https://exemplo.test',
      orcidId: null,
      lattesId: null,
      audiences: { ...matrix('PRIVATE'), level: 'PUBLIC', headline: 'PUBLIC' },
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);

    const result = await getPublicProfile({
      tenantSlug: slugA,
      username: `matriz-${RUN}`,
      viewerUserId: null,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.page.profile).sort()).toEqual(['headline', 'level', 'levelTitle', 'prestige', 'username']);
    expect(result.page.profile.bio).toBeUndefined();
    expect(result.page.profile.interests).toBeUndefined();
    expect(result.page.profile.certificates).toBeUndefined();
  });

  it('perfil com TUDO privado responde 404 para os outros — e o dono vê a própria prévia', async () => {
    const saved = await savePublicProfile({
      tenantId: tenantA,
      userId: elisa,
      username: `elisa-${RUN}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: matrix('PRIVATE'),
      indexable: false,
      listedInDirectory: false,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);

    const anonimo = await getPublicProfile({
      tenantSlug: slugA,
      username: `elisa-${RUN}`,
      viewerUserId: null,
    });

    expect(anonimo.ok).toBe(false);
    if (!anonimo.ok) {
      expect(anonimo.code).toBe('NOT_FOUND');
      /** A mensagem não afirma que o handle existe: é isso que ele decidiu esconder. */
      expect(anonimo.message).toBe('Perfil não encontrado.');
    }

    const daCasa = await getPublicProfile({
      tenantSlug: slugA,
      username: `elisa-${RUN}`,
      viewerUserId: bruno,
    });

    expect(daCasa.ok).toBe(false);

    const dono = await getPublicProfile({
      tenantSlug: slugA,
      username: `elisa-${RUN}`,
      viewerUserId: elisa,
    });

    expect(dono.ok, dono.ok ? 'ok' : dono.message).toBe(true);
    if (dono.ok) {
      expect(dono.page.viewer).toBe('OWNER');
      expect(dono.page.isOwner).toBe(true);
      expect(dono.page.visibleFields.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a instituição é o limite', () => {
  it('o MESMO handle não abre página numa instituição onde a pessoa não participa', async () => {
    /**
     * O `user` é global e a RLS não o protege. Sem esta guarda, o nome, a foto e a bio
     * de ana apareceriam no site da instituição B — onde ela nunca esteve.
     */
    const naB = await getPublicProfile({
      tenantSlug: slugB,
      username: HANDLE_ANA,
      viewerUserId: null,
    });

    expect(naB.ok).toBe(false);
    if (!naB.ok) expect(naB.code).toBe('NOT_FOUND');

    /** Nem para quem é da casa B: a página é de quem participa. */
    const porDuda = await getPublicProfile({
      tenantSlug: slugB,
      username: HANDLE_ANA,
      viewerUserId: duda,
    });

    expect(porDuda.ok).toBe(false);
  });

  it('a decisão de visibilidade é uma só, mas o diretório e os eventos são de cada casa', async () => {
    const saved = await savePublicProfile({
      tenantId: tenantB,
      userId: duda,
      username: HANDLE_DUDA,
      headline: 'Engenheira de dados',
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: {},
      indexable: false,
      listedInDirectory: true,
      publicNameInResults: false,
      publicEventIds: [],
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);

    const naB = await getPublicProfile({ tenantSlug: slugB, username: HANDLE_DUDA, viewerUserId: null });
    expect(naB.ok, naB.ok ? 'ok' : naB.message).toBe(true);
    if (naB.ok) expect(naB.page.tenantSlug).toBe(slugB);

    /** Duda não tem vínculo com A: lá ela não aparece no diretório nem tem página. */
    const diretorioA = await listDirectoryProfiles({ tenantId: tenantA });
    expect(diretorioA.map((row) => row.username)).not.toContain(HANDLE_DUDA);

    const naA = await getPublicProfile({ tenantSlug: slugA, username: HANDLE_DUDA, viewerUserId: null });
    expect(naA.ok).toBe(false);

    const diretorioB = await listDirectoryProfiles({ tenantId: tenantB });
    expect(diretorioB.map((row) => row.username)).toContain(HANDLE_DUDA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('diretório de participantes', () => {
  it('nasce DESLIGADO e só lista quem ligou E tem página', async () => {
    /** Antes de qualquer coisa: ninguém ligou o diretório. */
    const inicial = await listDirectoryProfiles({ tenantId: tenantA });
    expect(inicial).toHaveLength(0);

    const saved = await savePublicProfile({
      tenantId: tenantA,
      userId: ana,
      username: HANDLE_ANA,
      headline: HEADLINE_ANA,
      bio: BIO_ANA,
      interests: ['Saúde pública', 'Dados abertos'],
      siteUrl: 'https://ana.test',
      orcidId: '0000-0002-1825-0097',
      lattesId: '1234567890123456',
      audiences: {},
      indexable: false,
      listedInDirectory: true,
      publicNameInResults: false,
      publicEventIds: [eventA2025],
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);

    const lista = await listDirectoryProfiles({ tenantId: tenantA });

    expect(lista.map((row) => row.username)).toEqual([HANDLE_ANA]);
    expect(lista[0]).toMatchObject({
      username: HANDLE_ANA,
      displayName: 'Ana Souza',
      headline: HEADLINE_ANA,
      level: 5,
    });

    /** Bruno tem handle e está na casa, mas o diretório dele continua desligado. */
    expect(lista.map((row) => row.username)).not.toContain(`bruno-2-${RUN}`);
  });

  it('quem tem tudo privado não entra no diretório, mesmo com a caixa ligada', async () => {
    const pessoa = await createUser('Privada no Diretório F44');
    await addMember(pessoa, tenantA);

    await savePublicProfile({
      tenantId: tenantA,
      userId: pessoa,
      username: `sumida-${RUN}`,
      headline: null,
      bio: null,
      interests: [],
      siteUrl: null,
      orcidId: null,
      lattesId: null,
      audiences: matrix('PRIVATE'),
      indexable: false,
      listedInDirectory: true,
      publicNameInResults: false,
      publicEventIds: [],
    });

    const lista = await listDirectoryProfiles({ tenantId: tenantA });

    expect(lista.map((row) => row.username)).not.toContain(`sumida-${RUN}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a posição relativa', () => {
  it('quem tem mais XP recebe a MELHOR fatia — a direção do cálculo', async () => {
    /**
     * ─── O DEFEITO QUE ESTE TESTE PEGOU ─────────────────────────────────────────
     *  A contagem lia quem tem MAIS XP e a fórmula esperava quem tem MENOS: o primeiro
     *  colocado recebia "top 100%" e o último, "top 1%" — o inverso do que a página
     *  afirmava. Com três pessoas (400, 100 e 50 XP), ana supera duas.
     */
    const result = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: bruno,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.page.profile.standing).toEqual({ topPercent: 34, sampleSize: 3 });

    const menor = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: bruno,
    });
    if (!menor.ok) return;

    const perfilBruno = await getPublicProfile({
      tenantSlug: slugA,
      username: `bruno-2-${RUN}`,
      viewerUserId: bruno,
    });

    expect(perfilBruno.ok, perfilBruno.ok ? 'ok' : perfilBruno.message).toBe(true);
    if (!perfilBruno.ok) return;

    /** Bruno (100 XP, com o dono acima dele e ainda um abaixo) não pode ter fatia melhor. */
    expect(perfilBruno.page.profile.standing!.topPercent).toBeGreaterThan(
      result.page.profile.standing!.topPercent,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('consentir não paga XP, e a trilha guarda a decisão', () => {
  it('publicar o perfil não credita nada e não cria fato de XP', async () => {
    const antes = await totalXp(tenantA, ana);
    const fatosAntes = await xpFactCount(tenantA, ana);

    const saved = await savePublicProfile({
      tenantId: tenantA,
      userId: ana,
      username: HANDLE_ANA,
      headline: HEADLINE_ANA,
      bio: BIO_ANA,
      interests: ['Saúde pública', 'Dados abertos'],
      siteUrl: 'https://ana.test',
      orcidId: '0000-0002-1825-0097',
      lattesId: '1234567890123456',
      audiences: matrix('PUBLIC'),
      indexable: true,
      listedInDirectory: true,
      publicNameInResults: true,
      publicEventIds: [eventA2025],
    });

    expect(saved.ok, saved.ok ? 'ok' : saved.message).toBe(true);

    expect(await totalXp(tenantA, ana)).toBe(antes);
    expect(await xpFactCount(tenantA, ana)).toBe(fatosAntes);

    /**
     * A decisão do NOME no resultado público do sorteio (dívida **E35**, aberta na FASE
     * 22) passa pela mesma tela e pelo mesmo serviço — e, como as outras, não paga XP.
     */
    const nomePublico = await withTenant(tenantA, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: ana }, select: { isPublicProfile: true } }),
    );

    expect(nomePublico.isPublicProfile).toBe(true);
  });

  it('a auditoria registra QUEM divulgou o quê — e nunca o conteúdo', async () => {
    const entradas = await profileAudit(tenantA, 'UPDATE');

    expect(entradas.length).toBeGreaterThan(0);

    const daAna = entradas.filter((entry) => entry.entityId === ana);
    expect(daAna.length).toBeGreaterThan(0);

    const ultima = daAna[0]!;

    expect(Object.keys(ultima.changes).sort()).toEqual([
      'achavelEmBuscadores',
      'camposDivulgados',
      'camposPrivados',
      'eventosEscolhidos',
      'handle',
      'noDiretorioDaInstituicao',
      'nomeCompletoNoResultado',
    ]);

    /** A BIO não é copiada: a trilha guarda a decisão, não o dado pessoal. */
    const serializado = JSON.stringify(ultima.changes);
    expect(serializado).not.toContain('vigilância epidemiológica');
    expect(serializado).not.toContain('ana.test');
    expect(serializado).not.toContain('0000-0002-1825-0097');
    expect(serializado).toContain('nenhum');
  });

  it('a LEITURA de outra pessoa entra na trilha; a prévia do dono, não', async () => {
    const antes = (await profileAudit(tenantA, 'READ')).length;

    await getPublicProfile({ tenantSlug: slugA, username: HANDLE_ANA, viewerUserId: bruno });

    const depois = await profileAudit(tenantA, 'READ');
    expect(depois.length).toBe(antes + 1);
    expect(depois[0]!.entityId).toBe(ana);
    expect(depois[0]!.actorName).toBe('Bruno Lima');

    /** O dono olhando o próprio perfil não gera leitura auditada. */
    const semDono = (await profileAudit(tenantA, 'READ')).length;

    await getPublicProfile({ tenantSlug: slugA, username: HANDLE_ANA, viewerUserId: ana });

    expect((await profileAudit(tenantA, 'READ')).length).toBe(semDono);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('institucionalidade da leitura', () => {
  it('instituição inexistente e handle inexistente respondem o MESMO 404', async () => {
    const semTenant = await getPublicProfile({
      tenantSlug: `nao-existe-${RUN}`,
      username: HANDLE_ANA,
      viewerUserId: null,
    });

    expect(semTenant.ok).toBe(false);
    if (!semTenant.ok) expect(semTenant.code).toBe('NOT_FOUND');

    const semPessoa = await getPublicProfile({
      tenantSlug: slugA,
      username: `ninguem-${RUN}`,
      viewerUserId: null,
    });

    expect(semPessoa.ok).toBe(false);
    if (!semPessoa.ok) expect(semPessoa.code).toBe('NOT_FOUND');
  });
});
