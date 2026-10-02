/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — A OCULTAÇÃO DO PERFIL VALE PARA TODA SUPERFÍCIE QUE
 *  CITA A PESSOA (FASE 60 · dívida E79)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a decisão da moderação (`decideReport`, o serviço REAL da plataforma) grava
 *      `User.publicProfileHiddenAt` e o efeito atravessa o serviço de verdade;
 *    • a vitrine do evento (`getPublicEvent.organizers`) para de citar a pessoa —
 *      nome, foto, e-mail, etiqueta da equipe e o JSON inteiro;
 *    • a LINHA da equipe continua no banco: o quadro de demandas depende dela, e a
 *      ocultação é medida de VISIBILIDADE, não exclusão (mesma régua de quem perdeu
 *      o vínculo);
 *    • o link selado da carta continua ABRINDO (decisão da F60), sem nome, sem
 *      `@handle` e sem foto — e o dono vê o mesmo rótulo na tela dele;
 *    • quem NÃO foi ocultado continua aparecendo nas duas superfícies: a régua é da
 *      pessoa, e não um blecaute da página.
 *
 *  A ordem dos cenários É o teste: mostrar (antes) → decidir → sumir (depois). Ela
 *  depende do estado durável no banco, e não de variável preenchida por outro teste.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import { getPublicProfile, listDirectoryProfiles, savePublicProfile } from '../../src/lib/profile/public-profile-service';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import {
  NEUTRAL_SHARE_NAME,
  ensureCardShareLink,
  getCardShareState,
  readSharedCard,
} from '../../src/lib/gamification/card-share-service';

const RUN = randomUUID().slice(0, 8);

const EVENT_SLUG = `evento-f60-${RUN}`;
const TENANT_SLUG = `f60-${RUN}`;
const HANDLE_ANA = `ana-f60-${RUN}`;
const HANDLE_BRUNO = `bruno-f60-${RUN}`;
const FOTO_ANA = `https://acervo.exemplo.test/${RUN}/ana.webp`;
const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

let tenantId: string;
let eventId: string;

let ana: string;
let bruno: string;
let denunciante: string;
let moderador: string;

let userCardId: string;
let token = '';
let reportId: string;

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(input: {
  name: string;
  image?: string | null;
  platformRole?: boolean;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.name,
      email: `f60.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
      image: input.image ?? null,
    },
  });

  if (input.platformRole) {
    await adminPrisma.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        userId: id,
        role: 'SUPERADMIN',
        scope: 'PLATFORM',
        reason: 'Moderador do teste de integração da FASE 60',
      },
    });
  }

  return id;
}

/** Vínculo ativo com a casa — é ele que faz a pessoa existir na vitrine do evento. */
async function addMember(userId: string): Promise<void> {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });
}

/** Grava o perfil público pelo serviço, como a tela da pessoa faria. */
async function saveProfile(userId: string, username: string): Promise<void> {
  const result = await savePublicProfile({
    tenantId,
    userId,
    username,
    headline: 'Pesquisadora em saúde pública',
    bio: null,
    interests: [],
    siteUrl: null,
    orcidId: null,
    lattesId: null,
    contacts: {},
    /** Nome e foto PÚBLICOS: o cenário precisa da identidade no ar antes da medida. */
    audiences: { displayName: 'PUBLIC', avatar: 'PUBLIC' },
    indexable: false,
    listedInDirectory: true,
    publicNameInResults: false,
    publicEventIds: [],
  });

  expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição da Ocultação ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  const future = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: 'Congresso da Ocultação',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: future,
        endsAt: new Date(future.getTime() + 86_400_000),
        confirmedCount: 0,
      },
    }),
  );

  ana = await createUser({ name: 'Ana Souza', image: FOTO_ANA });
  bruno = await createUser({ name: 'Bruno Lima' });
  denunciante = await createUser({ name: 'Quem Denuncia' });
  moderador = await createUser({ name: 'Moderador da Plataforma', platformRole: true });

  await addMember(ana);
  await addMember(bruno);

  /** As duas pessoas na MESMA equipe: uma será ocultada, a outra é o contraste. */
  await withTenant(tenantId, (tx) =>
    tx.eventTeam.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        name: 'Presidência',
        members: {
          create: [
            { id: randomUUID(), tenantId, userId: ana, isLead: true },
            { id: randomUUID(), tenantId, userId: bruno },
          ],
        },
      },
    }),
  );

  await saveProfile(ana, HANDLE_ANA);
  await saveProfile(bruno, HANDLE_BRUNO);

  /** A carta de Ana, com link selado criado pelo MESMO serviço que a tela usa. */
  const templateId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.cardTemplate.create({
      data: {
        id: templateId,
        tenantId,
        eventId: null,
        slug: `guardiao-${RUN}`,
        name: 'Guardião do Método',
        description: 'Concedida por concluir um parecer.',
        lore: 'O trabalho invisível que sustenta a ciência',
        rarity: 'LEGENDARY',
        trigger: 'REVIEW_COMPLETED',
      },
    }),
  );

  userCardId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.userCard.create({
      data: {
        id: userCardId,
        tenantId,
        userId: ana,
        cardTemplateId: templateId,
        quantity: 1,
        source: 'REVIEW_COMPLETED',
      },
    }),
  );

  const link = await ensureCardShareLink({
    tenantId,
    userId: ana,
    tenantSlug: TENANT_SLUG,
    tenantName: `Instituição da Ocultação ${RUN}`,
    userCardId,
  });

  expect(link.ok, link.ok ? 'ok' : link.message).toBe(true);
  if (link.ok && link.state.url) token = link.state.url.split('/').pop() ?? '';
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('antes da decisão, as duas superfícies citam a pessoa', () => {
  it('a vitrine da equipe mostra Ana com a etiqueta da equipe', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const card = event.organizers.find((row) => row.userId === ana);

    expect(card?.name).toBe('Ana Souza');
    expect(card?.labels).toEqual(['Presidência']);
    expect(card?.isLead).toBe(true);
  });

  it('o link selado mostra o nome, o @handle e a foto', async () => {
    const shared = await readSharedCard({ tenantId, token, timezone: 'America/Bahia' });

    expect(shared.ok, shared.ok ? 'ok' : shared.message).toBe(true);
    if (!shared.ok) return;

    expect(shared.card.displayName).toBe('Ana Souza');
    expect(shared.card.avatarUrl).toBe(FOTO_ANA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a decisão da moderação (serviço real da plataforma)', () => {
  it('a denúncia entra na fila e o OCULTAR grava o efeito no perfil', async () => {
    const reported = await reportPublicProfile({
      tenantId,
      reporterUserId: denunciante,
      username: HANDLE_ANA,
      category: 'PRIVACY',
      details: 'O perfil publica o telefone de uma terceira pessoa, sem autorização dela.',
    });

    expect(reported.ok, reported.ok ? 'ok' : reported.message).toBe(true);
    if (!reported.ok) return;

    reportId = reported.reportId;

    const decided = await decideReport({
      reportId,
      action: 'HIDE',
      note: NOTA,
      actorId: moderador,
    });

    expect(decided.ok, decided.ok ? 'ok' : decided.message).toBe(true);
    if (!decided.ok) return;

    expect(decided.hiddenProfile).toBe(true);

    /**
     * O efeito é lido do BANCO: a medida vale para a PESSOA (o `@handle` é global), e a
     * linha da equipe NÃO é tocada por ela.
     */
    const pessoa = await adminPrisma.user.findUniqueOrThrow({
      where: { id: ana },
      select: { publicProfileHiddenAt: true, publicHandle: true },
    });

    expect(pessoa.publicProfileHiddenAt).not.toBeNull();
    expect(pessoa.publicHandle).toBe(HANDLE_ANA);

    const naEquipe = await withTenant(tenantId, (tx) =>
      tx.eventTeamMember.count({ where: { tenantId, userId: ana } }),
    );

    expect(naEquipe).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a vitrine da equipe depois da decisão', () => {
  it('deixa de citar a pessoa ocultada — nome, etiqueta, e-mail e foto', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    expect(event.organizers.map((card) => card.userId)).not.toContain(ana);

    /** A checagem é sobre o JSON inteiro: nada da pessoa pode sobrar escondido. */
    const serialized = JSON.stringify(event.organizers);
    expect(serialized).not.toContain('Ana Souza');
    expect(serialized).not.toContain(HANDLE_ANA);
    expect(serialized).not.toContain(FOTO_ANA);
    expect(serialized).not.toContain(`f60.${RUN}`);
  });

  it('quem NÃO foi ocultado continua na vitrine (a régua é da pessoa)', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    const card = event.organizers.find((row) => row.userId === bruno);

    expect(card?.name).toBe('Bruno Lima');
    expect(card?.labels).toEqual(['Presidência']);
  });

  it('a página pública e o diretório usam a MESMA régua', async () => {
    const pagina = await getPublicProfile({
      tenantSlug: TENANT_SLUG,
      username: HANDLE_ANA,
      viewerUserId: null,
    });

    expect(pagina.ok, pagina.ok ? 'ok' : pagina.message).toBe(true);
    if (!pagina.ok) return;

    expect(pagina.page.hiddenReason).toBe(NOTA);
    expect(Object.keys(pagina.page.profile)).toEqual(['username']);

    const diretorio = await listDirectoryProfiles({ tenantId });

    expect(diretorio.map((row) => row.username)).not.toContain(HANDLE_ANA);
    expect(diretorio.map((row) => row.username)).toContain(HANDLE_BRUNO);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o link selado da carta depois da decisão', () => {
  it('continua ABRINDO, sem nome, sem @handle e sem foto', async () => {
    const shared = await readSharedCard({ tenantId, token, timezone: 'America/Bahia' });

    /** A decisão é mostrar a carta sem a identidade — e não fechar o link (ver o PORQUÊ). */
    expect(shared.ok, shared.ok ? 'ok' : shared.message).toBe(true);
    if (!shared.ok) return;

    expect(shared.card.displayName).toBe(NEUTRAL_SHARE_NAME);
    expect(shared.card.avatarUrl).toBeNull();
    expect(shared.card.cardName).toBe('Guardião do Método');

    const serialized = JSON.stringify(shared.card);
    expect(serialized).not.toContain('Ana Souza');
    expect(serialized).not.toContain(HANDLE_ANA);
    expect(serialized).not.toContain(FOTO_ANA);
    expect(serialized).not.toContain(`f60.${RUN}`);
  });

  it('o dono vê na tela o MESMO rótulo que o link publica', async () => {
    const state = await getCardShareState({
      tenantId,
      userId: ana,
      tenantSlug: TENANT_SLUG,
      userCardId,
    });

    expect(state.ok, state.ok ? 'ok' : state.message).toBe(true);
    if (!state.ok) return;

    expect(state.state.shareDisplayName).toBe(NEUTRAL_SHARE_NAME);
    expect(state.state.showsRealName).toBe(false);
    expect(state.state.shareText).not.toContain('Ana Souza');
  });
});
