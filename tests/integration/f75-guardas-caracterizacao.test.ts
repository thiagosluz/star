/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — AS 21 GUARDAS LOCAIS, PERMITIDO × RECUSADO
 *                                                     (FASE 75 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 2 vai trocar as guardas locais por `guardAction`. Das 21 guardas,
 *  19 só tinham E2E de caminho feliz — e refactor de autorização sem rede pode
 *  AMPLIAR acesso em silêncio. Este arquivo é a rede: para CADA guarda, um caso
 *  PERMITIDO e um RECUSADO, com o código e a mensagem que ela devolve HOJE.
 *
 *  Ele é CARACTERIZAÇÃO, não especificação: prende o comportamento atual, inclusive
 *  onde ele é estranho. Onde um caso revelou um defeito, o defeito está relatado no
 *  documento da fase e o teste prende o que EXISTE — consertar é decisão à parte.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS GUARDAS SÃO PRIVADAS; O CAMINHO TESTADO É A SERVER ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todas as 21 são `async function guard*` NÃO exportadas dentro de módulos
 *  `'use server'` (que só podem exportar funções assíncronas). Não há como chamá-las
 *  de fora — e chamá-las não seria o caminho de ninguém.
 *
 *  Então cada caso entra pela MESMA porta que o navegador usa: a Server Action. O
 *  "permitido" é provado pelo que só acontece DEPOIS da guarda — a recusa do
 *  serviço com o alvo que não existe, ou o sucesso de verdade com efeito no banco.
 *  Se a guarda recusasse, a resposta seria o `FORBIDDEN` dela (e é isso que o caso
 *  "recusado" prende, com a mensagem exata).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SESSÃO É SUBSTITUÍDA; O RBAC NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getAuthenticatedUser` lê o cookie do Better Auth, que não existe fora de uma
 *  requisição do Next — só ele é dublado. `user_tenant_profiles`, `role_assignments`,
 *  `loadPrincipal` (sob RLS) e `can`/`holdsPermission` rodam de VERDADE.
 *
 *  Cada caso diz o PAPEL e o ESCOPO usados. Os escopos são os do sistema real:
 *  TENANT (a instituição inteira), EVENT (o evento do dia) e ACTIVITY (a atividade
 *  do palestrante) — os dois últimos existem porque há guardas que só fazem sentido
 *  com eles.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE É DUBLADO, ALÉM DA SESSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *   • `next/cache`  — `revalidatePath` só existe dentro de uma requisição;
 *   • `next/headers`— `headers()` idem (credenciamento lê IP/user-agent);
 *   • `next/navigation` — `redirect()` de verdade lança `NEXT_REDIRECT`; aqui ele
 *     lança um sentinela com o destino, que é o que o caso do `registration` prende.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { can, holdsPermission } from '../../src/domain/rbac/authorization';
import { PERMISSIONS } from '../../src/domain/rbac/permissions';
import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { createDemand, createEventTeam } from '../../src/lib/events/demand-service';

// ───────────────────────────────────────────────────────────────────────────────
//  Dublês
// ───────────────────────────────────────────────────────────────────────────────
/** A sessão do caso — `vi.hoisted` porque o dublê é içado antes das declarações. */
const sessao = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('../../src/lib/auth/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/auth/session')>();

  return {
    ...real,
    getAuthenticatedUser: async () =>
      sessao.userId === null
        ? null
        : {
            id: sessao.userId,
            name: 'Pessoa do teste',
            email: `${sessao.userId}@exemplo.test`,
            image: null,
            publicHandle: null,
            emailVerified: true,
          },
  };
});

vi.mock('next/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('next/cache')>();

  return {
    ...real,
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
  };
});

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}));

/** O sentinela do `redirect` — é o "estado" observável do caso sem sessão. */
const { Redirecionamento } = vi.hoisted(() => {
  class Redirecionamento extends Error {
    constructor(readonly destino: string) {
      super(`redirecionou para ${destino}`);
    }
  }

  return { Redirecionamento };
});

vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionamento(destino);
  },
  permanentRedirect: (destino: string) => {
    throw new Redirecionamento(destino);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

// ───────────────────────────────────────────────────────────────────────────────
//  Módulos das actions (importados DEPOIS dos dublês)
// ───────────────────────────────────────────────────────────────────────────────
const pagina = await import('../../src/app/actions/tenant-page-actions');
const equipes = await import('../../src/app/actions/team-order-actions');
const portal = await import('../../src/app/actions/sponsor-portal-actions');
const patrocinio = await import('../../src/app/actions/sponsor-actions');
const palestrantes = await import('../../src/app/actions/speaker-actions');
const revisao = await import('../../src/app/actions/review-actions');
const inscricoes = await import('../../src/app/actions/registration-actions');
const sorteios = await import('../../src/app/actions/raffle-actions');
const membros = await import('../../src/app/actions/member-actions');
const landing = await import('../../src/app/actions/landing-actions');
const gamificacao = await import('../../src/app/actions/gamification-actions');
const demandas = await import('../../src/app/actions/demand-actions');
const comunicacao = await import('../../src/app/actions/communication-actions');
const certificados = await import('../../src/app/actions/certificate-actions');
const catalogo = await import('../../src/app/actions/catalog-archive-actions');
const telao = await import('../../src/app/actions/bigscreen-actions');
const presenca = await import('../../src/app/actions/attendance-actions');
const admin = await import('../../src/app/actions/admin-actions');

// ───────────────────────────────────────────────────────────────────────────────
//  Forma comum das respostas — o que TODAS as 21 guardas devolvem na recusa
// ───────────────────────────────────────────────────────────────────────────────
interface RespostaDeAction {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
}

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let tenantSlug: string;
let evento1: string;
let evento2: string;
let atividade: string;
let trilha: string;

/** OWNER: a única pessoa com `tenant:role:assign` (decisão de matriz, FASE 21). */
let owner: string;
/** ORGANIZER no TENANT: o papel que opera o evento e o patrocínio. */
let organizador: string;
/** FINANCE no TENANT: tem `sponsor:manage` e NADA de página/evento. */
let financeiro: string;
/** STAFF no TENANT: opera o balcão e o quadro, e não organiza. */
let staff: string;
/** PARTICIPANT no TENANT: o mínimo — inscrição, XP, submissão. */
let participante: string;
/**
 * STAFF com o papel concedido no ESCOPO DO EVENTO 1 — existe para o caso do alvo
 * EVENT: o mesmo papel vale no evento dele e não vale no vizinho.
 */
let staffDoEvento1: string;
/**
 * SPEAKER com o papel concedido no ESCOPO DA ATIVIDADE — o caso que `can()` com
 * escopo TENANT recusaria, e que a guarda do palestrante aceita de propósito.
 */
let palestranteDaAtividade: string;
/** Pessoa SEM vínculo nenhum: o caso do aceite de convite e o da sessão sem vínculo. */
let semVinculo: string;

/** Demandas reais: sem elas a recusa do serviço vem antes da checagem de liderança. */
let demandaDaEquipeDoStaff: string;
let demandaDeOutraEquipe: string;

function formulario(entries: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();

  for (const [chave, valor] of Object.entries(entries)) {
    if (typeof valor === 'string') {
      data.set(chave, valor);
    } else {
      for (const item of valor) data.append(chave, item);
    }
  }

  return data;
}

async function criarPessoa(input: {
  nome: string;
  papel?: 'OWNER' | 'ORGANIZER' | 'FINANCE' | 'STAFF' | 'PARTICIPANT' | 'SPEAKER';
  escopo?: 'TENANT' | 'EVENT' | 'ACTIVITY';
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.nome,
      email: `f75.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  /** Sem papel = sem vínculo: é a pessoa "de fora" do aceite de convite. */
  if (!input.papel) return id;

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: id,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  await withTenant(tenantId, (tx) =>
    tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: id,
        role: input.papel!,
        scope: input.escopo ?? 'TENANT',
        eventId: input.escopo === 'TENANT' ? null : evento1,
        activityId: input.escopo === 'ACTIVITY' ? atividade : null,
      },
    }),
  );

  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  tenantSlug = `f75-guardas-${RUN}`;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: tenantSlug,
      name: `Instituição das Guardas ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  evento1 = randomUUID();
  evento2 = randomUUID();
  atividade = randomUUID();
  trilha = randomUUID();

  const startsAt = new Date(Date.now() + 30 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 86_400_000);

  await withTenant(tenantId, async (tx) => {
    for (const [id, slug] of [
      [evento1, `evento-1-${RUN}`],
      [evento2, `evento-2-${RUN}`],
    ] as const) {
      await tx.event.create({
        data: {
          id,
          tenantId,
          slug,
          title: `Evento ${slug}`,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt,
          endsAt,
          capacity: null,
          confirmedCount: 0,
        },
      });
    }

    /** Existe para o papel de escopo ACTIVITY (a FK da concessão exige a linha). */
    await tx.activity.create({
      data: {
        id: atividade,
        tenantId,
        eventId: evento1,
        slug: `atividade-${RUN}`,
        title: 'Atividade das guardas',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        capacity: null,
      },
    });

    /** A trilha do caso PERMITIDO da submissão: sem trilha real, o serviço recusa antes. */
    await tx.track.create({
      data: {
        id: trilha,
        tenantId,
        eventId: evento1,
        slug: `trilha-${RUN}`,
        name: 'Trilha das guardas',
        requiresBlindReview: false,
        requiredReviews: 2,
        maxSubmissionsPerAuthor: 0,
      },
    });
  });

  owner = await criarPessoa({ nome: 'Proprietária', papel: 'OWNER' });
  organizador = await criarPessoa({ nome: 'Organizador', papel: 'ORGANIZER' });
  financeiro = await criarPessoa({ nome: 'Financeiro', papel: 'FINANCE' });
  staff = await criarPessoa({ nome: 'Equipe de operação', papel: 'STAFF' });
  participante = await criarPessoa({ nome: 'Participante', papel: 'PARTICIPANT' });
  staffDoEvento1 = await criarPessoa({ nome: 'Equipe do evento 1', papel: 'STAFF', escopo: 'EVENT' });
  palestranteDaAtividade = await criarPessoa({
    nome: 'Palestrante da atividade',
    papel: 'SPEAKER',
    escopo: 'ACTIVITY',
  });
  semVinculo = await criarPessoa({ nome: 'Pessoa sem vínculo' });

  /**
   * Duas demandas e duas equipes para o caso do `demand:assign:own-team`.
   *
   * Uma demanda INEXISTENTE não serve: o serviço responde `NOT_FOUND` antes de
   * conferir a liderança, e aí o caminho alternativo (`viaAlternate`) ficaria
   * invisível. Com a demanda real, o MESMO formulário responde diferente para quem
   * coordena e para quem só lidera.
   */
  const equipeDoStaff = await createEventTeam({
    tenantId,
    eventId: evento1,
    actorId: organizador,
    name: `Equipe do staff ${RUN}`,
    memberIds: [staff],
    leadId: staff,
  });

  const outraEquipe = await createEventTeam({
    tenantId,
    eventId: evento1,
    actorId: organizador,
    name: `Equipe vizinha ${RUN}`,
    memberIds: [participante],
  });

  if (!equipeDoStaff.ok || !outraEquipe.ok) {
    throw new Error('Falha ao criar as equipes da fixture.');
  }

  const daEquipeDoStaff = await createDemand({
    tenantId,
    eventId: evento1,
    actorId: organizador,
    title: 'Demanda da equipe liderada pelo staff',
    teamId: equipeDoStaff.teamId,
  });

  const deOutraEquipe = await createDemand({
    tenantId,
    eventId: evento1,
    actorId: organizador,
    title: 'Demanda de outra equipe',
    teamId: outraEquipe.teamId,
  });

  if (!daEquipeDoStaff.ok || !deOutraEquipe.ok) {
    throw new Error('Falha ao criar as demandas da fixture.');
  }

  demandaDaEquipeDoStaff = daEquipeDoStaff.demandId;
  demandaDeOutraEquipe = deOutraEquipe.demandId;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  1 · `tenant-page-actions.guard` (l. 86) — `page:manage`, escopo TENANT
// ═══════════════════════════════════════════════════════════════════════════════
describe('01 · tenant-page-actions.guard — page:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: o ok leva userId/tenantId/principal e a página nasce', async () => {
    sessao.userId = organizador;

    const resposta = await pagina.saveTenantPageSettingsAction(
      null,
      formulario({ tenantSlug, title: `Página da instituição ${RUN}`, description: 'Editor.' }),
    );

    /** `ok: true` só existe depois da guarda: é a prova de que ela devolveu o contexto. */
    expect(resposta).toEqual({
      ok: true,
      message:
        'Página criada como RASCUNHO. Ela ainda não aparece para os visitantes — publique quando estiver pronta.',
    });

    /** E o `tenantId` do contexto foi o usado na escrita — não um id inventado. */
    const linhas = await withTenant(tenantId, (tx) =>
      tx.tenantPublicPage.findMany({ where: { tenantId }, select: { id: true } }),
    );
    expect(linhas).toHaveLength(1);
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com a mensagem da guarda', async () => {
    sessao.userId = staff;

    const resposta = await pagina.saveTenantPageSettingsAction(
      null,
      formulario({ tenantSlug, title: 'Não deveria gravar' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: só quem administra a instituição edita a página pública.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  2 · `team-order-actions.guard` (l. 46) — `demand:team:manage`, alvo EVENT
// ═══════════════════════════════════════════════════════════════════════════════
describe('02 · team-order-actions.guard — demand:team:manage (alvo EVENT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: passa e o serviço responde pela equipe inexistente', async () => {
    sessao.userId = organizador;

    const resposta = await equipes.moveTeamOrderAction(
      null,
      formulario({ tenantSlug, eventId: evento1, teamId: randomUUID(), direction: 'up' }),
    );

    /** A recusa é do SERVIÇO (a equipe do formulário não existe), não da guarda. */
    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Equipe não encontrada.',
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN — o papel não tem `demand:team:manage`', async () => {
    sessao.userId = staff;

    const resposta = await equipes.moveTeamOrderAction(
      null,
      formulario({ tenantSlug, eventId: evento1, teamId: randomUUID(), direction: 'up' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: demand:team:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  3 · `sponsor-portal-actions.guardManage` (l. 51) — `sponsor:manage` (TENANT)
//      Exceção declarada: guarda sem permissão é a de baixo (l. 71), não esta.
// ═══════════════════════════════════════════════════════════════════════════════
describe('03 · sponsor-portal-actions.guardManage — sponsor:manage (TENANT)', () => {
  it('PERMITIDO · FINANCE no TENANT: passa e o QR inexistente é recusado pelo serviço', async () => {
    sessao.userId = financeiro;

    const resposta = await portal.setSponsorQrActiveAction(
      null,
      formulario({ tenantSlug, eventId: evento1, qrId: randomUUID(), isActive: 'true' }),
    );

    expect(resposta).toEqual({ ok: false, code: 'NOT_FOUND', message: 'QR não encontrado.' });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `sponsor:manage`', async () => {
    sessao.userId = staff;

    const resposta = await portal.setSponsorQrActiveAction(
      null,
      formulario({ tenantSlug, eventId: evento1, qrId: randomUUID(), isActive: 'true' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: sponsor:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  4 · `sponsor-portal-actions.guardAuthenticated` (l. 71)
//      EXCEÇÃO 1 de 4 — NÃO exige permissão NEM vínculo: sessão + instituição.
//      (O plano a descreve como "sessão + vínculo"; o código NÃO confere vínculo —
//      o defeito/divergência está relatado no documento da fase.)
// ═══════════════════════════════════════════════════════════════════════════════
describe('04 · sponsor-portal-actions.guardAuthenticated — sessão + instituição (EXCEÇÃO)', () => {
  it('PERMITIDO · pessoa SEM vínculo: entra, e a recusa é a do SERVIÇO (não a de vínculo)', async () => {
    sessao.userId = semVinculo;

    const resposta = await portal.acceptSponsorInviteAction(
      null,
      formulario({ tenantSlug, token: 'tokenquenaoexiste' }),
    );

    /**
     * O `ok` desta guarda carrega `userEmail` — é ele que o aceite usa para casar o
     * convite com o endereço. Aqui o que se prende é a AUSÊNCIA da checagem de
     * vínculo: quem não tem vínculo nenhum chega ao serviço.
     */
    expect(resposta).toEqual({
      ok: false,
      code: 'INVITE_INVALID',
      message: 'Convite não encontrado.',
    });
    expect(resposta.message).not.toBe('Você não tem vínculo ativo com esta instituição.');
  });

  it('RECUSADO · sem sessão: NOT_AUTHENTICATED (o único portão desta guarda)', async () => {
    sessao.userId = null;

    const resposta = await portal.acceptSponsorInviteAction(
      null,
      formulario({ tenantSlug, token: 'tokenqualquer' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_AUTHENTICATED',
      message: 'Sessão expirada. Entre novamente.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  5 · `sponsor-portal-actions.guardSession` (l. 96)
//      EXCEÇÃO 2 de 4 — exige VÍNCULO ATIVO e nenhuma permissão.
// ═══════════════════════════════════════════════════════════════════════════════
describe('05 · sponsor-portal-actions.guardSession — vínculo ATIVO, sem permissão (EXCEÇÃO)', () => {
  it('PERMITIDO · PARTICIPANT no TENANT (sem papel nenhum de patrocínio): passa', async () => {
    sessao.userId = participante;

    const resposta = await portal.revokeSponsorConsentAction(
      null,
      formulario({ tenantSlug, scanId: randomUUID() }),
    );

    /** O `ok` leva `userId`, `tenantId` e `userEmail`; a leitura é do serviço. */
    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Registro não encontrado.',
    });
  });

  it('RECUSADO · pessoa SEM vínculo: FORBIDDEN de vínculo (não de permissão)', async () => {
    sessao.userId = semVinculo;

    const resposta = await portal.revokeSponsorConsentAction(
      null,
      formulario({ tenantSlug, scanId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Você não tem vínculo ativo com esta instituição.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  6 · `sponsor-actions.guard` (l. 59) — `sponsor:manage`, escopo TENANT
// ═══════════════════════════════════════════════════════════════════════════════
describe('06 · sponsor-actions.guard — sponsor:manage (TENANT)', () => {
  it('PERMITIDO · FINANCE no TENANT: passa e o patrocinador inexistente é recusado pelo serviço', async () => {
    sessao.userId = financeiro;

    const resposta = await patrocinio.setSponsorActiveAction(
      null,
      formulario({ tenantSlug, eventId: evento1, sponsorId: randomUUID(), isActive: 'true' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Patrocinador não encontrado.',
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `sponsor:manage`', async () => {
    sessao.userId = staff;

    const resposta = await patrocinio.setSponsorActiveAction(
      null,
      formulario({ tenantSlug, eventId: evento1, sponsorId: randomUUID(), isActive: 'true' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: sponsor:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  7 · `speaker-actions.organizationGuard` (l. 147) — `speaker:manage` (TENANT)
// ═══════════════════════════════════════════════════════════════════════════════
describe('07 · speaker-actions.organizationGuard — speaker:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: o cadastro do palestrante é criado', async () => {
    sessao.userId = organizador;

    const resposta = await palestrantes.saveSpeakerProfileAction(
      null,
      formulario({ tenantSlug, name: `Palestrante ${RUN}` }),
    );

    /** O `ok` leva `userEmail`, `tenantSlug` e `principal`; a escrita confirma os dois ids. */
    expect(resposta).toEqual({
      ok: true,
      message: 'Palestrante cadastrado. Cadastre um e-mail para gerar o convite de acesso.',
      data: {
        speakerProfileId: expect.any(String),
        inviteToken: null,
        inviteExpiresAt: null,
      },
    });

    const perfis = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findMany({ where: { tenantId }, select: { id: true } }),
    );
    expect(perfis.length).toBeGreaterThanOrEqual(1);
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `speaker:manage`', async () => {
    sessao.userId = staff;

    const resposta = await palestrantes.saveSpeakerProfileAction(
      null,
      formulario({ tenantSlug, name: 'Não deveria cadastrar' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: speaker:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  8 · `speaker-actions.speakerGuard` (l. 202)
//      EXCEÇÃO 3 de 4 — `holdsPermission` SEM ALVO: o papel concedido por ATIVIDADE
//      entra. É o caso que `can()` com escopo TENANT recusaria.
// ═══════════════════════════════════════════════════════════════════════════════
describe('08 · speaker-actions.speakerGuard — holdsPermission sem alvo (EXCEÇÃO)', () => {
  it('PERMITIDO · SPEAKER concedido na ATIVIDADE (escopo ACTIVITY): entra no portal', async () => {
    sessao.userId = palestranteDaAtividade;

    const resposta = await palestrantes.updateMySpeakerProfileAction(
      null,
      formulario({ tenantSlug, speakerProfileId: randomUUID(), name: 'Nome do palestrante' }),
    );

    /** A recusa é a do serviço com o perfil inexistente — a guarda deixou passar. */
    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Perfil não encontrado.',
    });

    /**
     * ─── A PROVA DO MOTIVO DA EXCEÇÃO ────────────────────────────────────────────
     *  O MESMO principal e a MESMA permissão: `can()` com escopo TENANT diz NÃO
     *  (o papel foi concedido por atividade e não vaza para a instituição), e
     *  `holdsPermission` — que é o que a guarda usa — diz SIM. Trocar a guarda por
     *  `guardAction` com escopo TENANT fecharia o portal do palestrante.
     */
    const principal = await (
      await import('../../src/lib/auth/session')
    ).loadPrincipal(palestranteDaAtividade, tenantId, 'ACTIVE');

    expect(
      can(principal, PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN, { scope: 'TENANT' }, {
        ownerId: palestranteDaAtividade,
      }),
    ).toBe(false);
    expect(holdsPermission(principal, PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN)).toBe(true);
  });

  it('RECUSADO · STAFF no TENANT (papel nenhum de palestrante): FORBIDDEN próprio', async () => {
    sessao.userId = staff;

    const resposta = await palestrantes.updateMySpeakerProfileAction(
      null,
      formulario({ tenantSlug, speakerProfileId: randomUUID(), name: 'Nome do palestrante' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message:
        'Esta área é do palestrante. Fale com a organização para ser vinculado a uma atividade.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  9 · `review-actions.guard` (l. 81) — `submission:create`, escopo TENANT
// ═══════════════════════════════════════════════════════════════════════════════
describe('09 · review-actions.guard — submission:create (TENANT)', () => {
  it('PERMITIDO · PARTICIPANT no TENANT: o rascunho nasce e a action redireciona', async () => {
    sessao.userId = participante;

    const chamada = revisao.createSubmissionAction(
      null,
      formulario({
        tenantSlug,
        eventId: evento1,
        trackId: trilha,
        title: 'A submissão que prova a guarda',
        abstract: `${'Este resumo é longo o bastante para o serviço aceitar a submissão. '.repeat(3)}`,
        keywords: 'guardas, caracterização, rede',
      }),
    );

    /** O sucesso é um `redirect` — o "estado" observável é o destino. */
    await expect(chamada).rejects.toBeInstanceOf(Redirecionamento);

    const submissao = await withTenant(tenantId, (tx) =>
      tx.submission.findFirst({
        where: { tenantId, eventId: evento1, submittedById: participante },
        select: { id: true },
      }),
    );
    expect(submissao).not.toBeNull();
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `submission:create`', async () => {
    sessao.userId = staff;

    const resposta = await revisao.createSubmissionAction(
      null,
      formulario({
        tenantSlug,
        eventId: evento1,
        trackId: trilha,
        title: 'A submissão que não deve nascer',
        abstract: `${'Este resumo é longo o bastante para o serviço aceitar a submissão. '.repeat(3)}`,
        keywords: 'x',
      }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: submission:create.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  10 · `registration-actions.guard` (l. 94) — contrato PRÓPRIO:
//       `null` para "sem sessão/vínculo" (o chamador redireciona ao login) e
//       LANÇA quando há sessão e falta permissão.
// ═══════════════════════════════════════════════════════════════════════════════
describe('10 · registration-actions.guard — registration:cancel:own + posse (lança)', () => {
  it('PERMITIDO · PARTICIPANT no TENANT com posse (ownerId da sessão): passa', async () => {
    sessao.userId = participante;

    const resposta = await inscricoes.cancelRegistrationAction(
      null,
      formulario({ tenantSlug, eventSlug: `evento-1-${RUN}`, registrationId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_REGISTERED',
      message: 'Inscrição não encontrada.',
    });
  });

  it('RECUSADO · STAFF no TENANT (sem `registration:cancel:own`): LANÇA, não devolve estado', async () => {
    sessao.userId = staff;

    await expect(
      inscricoes.cancelRegistrationAction(
        null,
        formulario({ tenantSlug, eventSlug: `evento-1-${RUN}`, registrationId: randomUUID() }),
      ),
    ).rejects.toThrow(
      'Permissão negada: registration:cancel:own. Fale com a organização do evento.',
    );
  });

  it('SEM SESSÃO · devolve `null` e o chamador redireciona ao login', async () => {
    sessao.userId = null;

    /**
     * Este é o OUTRO lado do contrato do #12: sem sessão a guarda NÃO lança — ela
     * devolve `null`, e a action responde com um redirecionamento que preserva o
     * destino. Um refactor que trocasse `null` por `FORBIDDEN` mudaria a experiência
     * de quem só precisava entrar.
     */
    const chamada = inscricoes.cancelRegistrationAction(
      null,
      formulario({ tenantSlug, eventSlug: `evento-1-${RUN}`, registrationId: randomUUID() }),
    );

    await expect(chamada).rejects.toBeInstanceOf(Redirecionamento);
    await expect(
      inscricoes.cancelRegistrationAction(
        null,
        formulario({ tenantSlug, eventSlug: `evento-1-${RUN}`, registrationId: randomUUID() }),
      ),
    ).rejects.toMatchObject({
      destino: `/login?redirectTo=${encodeURIComponent(`/t/${tenantSlug}/eventos/evento-1-${RUN}`)}`,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  11 · `raffle-actions.guard` (l. 48) — `event:manage`, escopo TENANT
// ═══════════════════════════════════════════════════════════════════════════════
describe('11 · raffle-actions.guard — event:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: a prévia roda e devolve o quadro vazio', async () => {
    sessao.userId = organizador;

    const resposta = await sorteios.previewRaffleAction(
      null,
      formulario({ tenantSlug, eventId: evento1, scope: 'EVENT', winnersCount: '1' }),
    );

    expect(resposta.ok, resposta.message).toBe(true);
    expect(resposta.data).toMatchObject({ eligibleCount: 0 });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `event:manage`', async () => {
    sessao.userId = staff;

    const resposta = await sorteios.previewRaffleAction(
      null,
      formulario({ tenantSlug, eventId: evento1, scope: 'EVENT', winnersCount: '1' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: event:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  12 · `member-actions.guard` (l. 40) — `tenant:role:assign`, escopo TENANT
// ═══════════════════════════════════════════════════════════════════════════════
describe('12 · member-actions.guard — tenant:role:assign (TENANT)', () => {
  it('PERMITIDO · OWNER no TENANT: passa e o vínculo inexistente é recusado pelo serviço', async () => {
    sessao.userId = owner;

    const resposta = await membros.updateMemberRolesAction(
      null,
      formulario({ tenantSlug, userId: randomUUID(), roles: 'ADMIN' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Vínculo de equipe não encontrado.',
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN — trocar papéis é ato de dono', async () => {
    sessao.userId = staff;

    const resposta = await membros.updateMemberRolesAction(
      null,
      formulario({ tenantSlug, userId: randomUUID(), roles: 'ADMIN' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: tenant:role:assign.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  13 · `landing-actions.guard` (l. 59) — `page:manage` (a porta é a da tela)
// ═══════════════════════════════════════════════════════════════════════════════
describe('13 · landing-actions.guard — page:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: a página do evento nasce como rascunho', async () => {
    sessao.userId = organizador;

    const resposta = await landing.ensureHomePageAction(
      null,
      formulario({ tenantSlug, eventId: evento1 }),
    );

    expect(resposta).toEqual({
      ok: true,
      message: 'Página criada como RASCUNHO. Adicione blocos e publique quando estiver pronta.',
      data: { pageId: expect.any(String) },
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `page:manage`', async () => {
    sessao.userId = staff;

    const resposta = await landing.ensureHomePageAction(
      null,
      formulario({ tenantSlug, eventId: evento1 }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: page:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  14 · `gamification-actions.guard` (l. 66) — `xp:read:own` COM posse
//       O `ok` desta guarda leva `tenantName` (usado no texto de compartilhamento).
// ═══════════════════════════════════════════════════════════════════════════════
describe('14 · gamification-actions.guard — xp:read:own + posse (TENANT)', () => {
  it('PERMITIDO · PARTICIPANT no TENANT: a guarda devolve o contexto e a missão é buscada', async () => {
    sessao.userId = participante;

    const resposta = await gamificacao.claimMissionAction(
      null,
      formulario({ tenantSlug, taskDefinitionId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Missão não encontrada.',
    });
  });

  it('RECUSADO · STAFF no TENANT (sem `xp:read:own`): FORBIDDEN', async () => {
    sessao.userId = staff;

    const resposta = await gamificacao.claimMissionAction(
      null,
      formulario({ tenantSlug, taskDefinitionId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: xp:read:own.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  15 · `demand-actions.guard` (l. 60)
//       EXCEÇÃO 4 de 4 — OU de permissões (`demand:assign` × `...:own-team`) e
//       ALVO EVENT quando há `eventId`. O `viaAlternate` do `ok` é o que decide,
//       no serviço, entre "coordena" e "só lidera a própria equipe".
// ═══════════════════════════════════════════════════════════════════════════════
describe('15 · demand-actions.guard — OU de permissões + alvo EVENT (EXCEÇÃO)', () => {
  it('PERMITIDO · ORGANIZER no TENANT (`demand:assign`): viaAlternate=false e a atribuição grava', async () => {
    sessao.userId = organizador;

    const resposta = await demandas.assignDemandAction(
      null,
      formulario({ tenantSlug, eventId: evento1, demandId: demandaDeOutraEquipe }),
    );

    expect(resposta).toEqual({ ok: true, message: 'Responsáveis salvos.' });
  });

  it('PERMITIDO pelo CAMINHO ESTREITO · STAFF no TENANT (`:own-team`) na demanda da própria equipe', async () => {
    sessao.userId = staff;

    const resposta = await demandas.assignDemandAction(
      null,
      formulario({ tenantSlug, eventId: evento1, demandId: demandaDaEquipeDoStaff }),
    );

    /** `viaAlternate: true` chega ao serviço como `leadOnly` — e o líder pode. */
    expect(resposta).toEqual({ ok: true, message: 'Responsáveis salvos.' });
  });

  it('RECUSA DO SERVIÇO · o MESMO STAFF na demanda de OUTRA equipe: NOT_LEADER', async () => {
    sessao.userId = staff;

    const resposta = await demandas.assignDemandAction(
      null,
      formulario({ tenantSlug, eventId: evento1, demandId: demandaDeOutraEquipe }),
    );

    /**
     * Esta recusa só existe se a guarda tiver devolvido `viaAlternate: true`: com a
     * permissão de coordenar, a MESMA chamada responde `ok: true` (caso acima). É a
     * prova de que o booleano do `ok` é contrato, e não enfeite.
     */
    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_LEADER',
      message: 'Você só distribui demandas dentro da equipe que lidera.',
    });
  });

  it('RECUSADO · PARTICIPANT no TENANT (sem nenhuma das duas): FORBIDDEN', async () => {
    sessao.userId = participante;

    const resposta = await demandas.assignDemandAction(
      null,
      formulario({ tenantSlug, eventId: evento1, demandId: demandaDeOutraEquipe }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: demand:assign.',
    });
  });

  it('ALVO EVENT · STAFF concedido no EVENTO 1 passa no evento 1 e é recusado no evento 2', async () => {
    sessao.userId = staffDoEvento1;

    const noEventoDele = await demandas.assignDemandAction(
      null,
      formulario({ tenantSlug, eventId: evento1, demandId: demandaDeOutraEquipe }),
    );

    /** O papel do evento vale no evento dele: a recusa que vem é a do serviço. */
    expect(noEventoDele).toEqual({
      ok: false,
      code: 'NOT_LEADER',
      message: 'Você só distribui demandas dentro da equipe que lidera.',
    });

    const noEventoVizinho = await demandas.assignDemandAction(
      null,
      formulario({ tenantSlug, eventId: evento2, demandId: demandaDeOutraEquipe }),
    );

    /**
     * ─── O CASO MAIS PERIGOSO DESTA GUARDA ──────────────────────────────────────
     *  O `eventId` vem do FORMULÁRIO. Se a guarda ignorasse o alvo e checasse a
     *  permissão com escopo TENANT, o papel do evento 1 passaria também no evento 2
     *  — e um líder de equipe de um evento distribuiria trabalho no outro.
     */
    expect(noEventoVizinho).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: demand:assign.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  16 · `communication-actions.guard` (l. 65) — `communication:read` (TENANT)
// ═══════════════════════════════════════════════════════════════════════════════
describe('16 · communication-actions.guard — communication:read (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: passa e o serviço responde pela mensagem', async () => {
    sessao.userId = organizador;

    const resposta = await comunicacao.retryEmailAction(
      null,
      formulario({ tenantSlug, emailMessageId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'ALREADY_SENT',
      message: 'Só é possível reenviar mensagens que falharam ou ainda estão na fila.',
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `communication:read`', async () => {
    sessao.userId = staff;

    const resposta = await comunicacao.retryEmailAction(
      null,
      formulario({ tenantSlug, emailMessageId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: communication:read.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  17 · `certificate-actions.guard` (l. 60) — `certificate:issue` (TENANT)
// ═══════════════════════════════════════════════════════════════════════════════
describe('17 · certificate-actions.guard — certificate:issue (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: o lote roda (zero elegíveis, e isso é sucesso)', async () => {
    sessao.userId = organizador;

    const resposta = await certificados.issueEventCertificatesAction(
      null,
      formulario({ tenantSlug, eventId: evento1, kinds: 'ATTENDANCE' }),
    );

    expect(resposta).toEqual({
      ok: true,
      message: '0 certificado(s) solicitado(s) — 0 gerado(s) agora, o restante na fila.',
      data: { requested: 0, skipped: 0, generated: 0 },
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `certificate:issue`', async () => {
    sessao.userId = staff;

    const resposta = await certificados.issueEventCertificatesAction(
      null,
      formulario({ tenantSlug, eventId: evento1, kinds: 'ATTENDANCE' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: certificate:issue.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  18 · `catalog-archive-actions.guard` (l. 39) — `card-template:manage`
// ═══════════════════════════════════════════════════════════════════════════════
describe('18 · catalog-archive-actions.guard — card-template:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: passa e a carta inexistente é recusada pelo serviço', async () => {
    sessao.userId = organizador;

    const resposta = await catalogo.restoreCardTemplateAction(
      null,
      formulario({ tenantSlug, cardTemplateId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Carta não encontrada.',
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `card-template:manage`', async () => {
    sessao.userId = staff;

    const resposta = await catalogo.restoreCardTemplateAction(
      null,
      formulario({ tenantSlug, cardTemplateId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: card-template:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  19 · `bigscreen-actions.guard` (l. 46) — `event:manage` (TENANT)
//       Guarda DUPLICADA de propósito (o comentário no arquivo diz por quê): é a
//       duplicação que a fatia 2 vai apagar — e por isso ela precisa de rede.
// ═══════════════════════════════════════════════════════════════════════════════
describe('19 · bigscreen-actions.guard — event:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: passa e o sorteio inexistente é recusado pelo serviço', async () => {
    sessao.userId = organizador;

    const resposta = await telao.setBigscreenVisibilityAction(
      null,
      formulario({ tenantSlug, eventId: evento1, raffleId: randomUUID(), visible: 'true' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Sorteio não encontrado.',
    });
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `event:manage`', async () => {
    sessao.userId = staff;

    const resposta = await telao.setBigscreenVisibilityAction(
      null,
      formulario({ tenantSlug, eventId: evento1, raffleId: randomUUID(), visible: 'true' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: event:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  20 · `attendance-actions.guard` (l. 35) — `registration:checkin` (TENANT)
//       A permissão entra como `string` e é convertida com `as never` no `can()`.
//       O defeito está relatado; aqui se prende o comportamento de hoje.
// ═══════════════════════════════════════════════════════════════════════════════
describe('20 · attendance-actions.guard — registration:checkin (TENANT)', () => {
  it('PERMITIDO · STAFF no TENANT: passa e a inscrição inexistente é recusada pelo serviço', async () => {
    sessao.userId = staff;

    const resposta = await presenca.checkInAction(
      null,
      formulario({ tenantSlug, registrationId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Inscrição não encontrada.',
    });
  });

  it('RECUSADO · PARTICIPANT no TENANT: FORBIDDEN com `registration:checkin`', async () => {
    sessao.userId = participante;

    const resposta = await presenca.checkInAction(
      null,
      formulario({ tenantSlug, registrationId: randomUUID() }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: registration:checkin.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  21 · `admin-actions.guard` (l. 72) — `track:manage` (TENANT)
//       A guarda com MAIS chamadores do sistema (16): a recusa dela é contrato de
//       dezesseis portas, e por isso o caso é obrigatório.
// ═══════════════════════════════════════════════════════════════════════════════
describe('21 · admin-actions.guard — track:manage (TENANT)', () => {
  it('PERMITIDO · ORGANIZER no TENANT: a trilha é criada', async () => {
    sessao.userId = organizador;

    const resposta = await admin.saveTrackAction(
      null,
      formulario({ tenantSlug, eventId: evento1, slug: `trilha-nova-${RUN}`, name: 'Trilha nova' }),
    );

    expect(resposta.ok, resposta.message).toBe(true);
    expect(resposta.message).toBe('Trilha criada.');
  });

  it('RECUSADO · STAFF no TENANT: FORBIDDEN com `track:manage`', async () => {
    sessao.userId = staff;

    const resposta = await admin.saveTrackAction(
      null,
      formulario({ tenantSlug, eventId: evento1, slug: `trilha-recusada-${RUN}`, name: 'Recusada' }),
    );

    expect(resposta).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Permissão negada: track:manage.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SEM SESSÃO — o primeiro portão de TODAS as guardas (menos a do registration,
//  que devolve `null` e redireciona; ela tem caso próprio na seção 10)
// ═══════════════════════════════════════════════════════════════════════════════
describe('sem sessão — NOT_AUTHENTICATED é o estado que todas devolvem hoje', () => {
  const casos: [string, () => Promise<RespostaDeAction>][] = [
    [
      'tenant-page',
      () => pagina.saveTenantPageSettingsAction(null, formulario({ tenantSlug, title: 'X' })),
    ],
    [
      'team-order',
      () =>
        equipes.moveTeamOrderAction(
          null,
          formulario({ tenantSlug, eventId: evento1, teamId: randomUUID(), direction: 'up' }),
        ),
    ],
    [
      'sponsor-portal.guardManage',
      () =>
        portal.setSponsorQrActiveAction(
          null,
          formulario({ tenantSlug, eventId: evento1, qrId: randomUUID(), isActive: 'true' }),
        ),
    ],
    [
      'sponsor-portal.guardAuthenticated',
      () => portal.acceptSponsorInviteAction(null, formulario({ tenantSlug, token: 'tokenqualquer' })),
    ],
    [
      'sponsor-portal.guardSession',
      () => portal.revokeSponsorConsentAction(null, formulario({ tenantSlug, scanId: randomUUID() })),
    ],
    [
      'sponsor-actions',
      () =>
        patrocinio.setSponsorActiveAction(
          null,
          formulario({ tenantSlug, eventId: evento1, sponsorId: randomUUID(), isActive: 'true' }),
        ),
    ],
    [
      'speaker.organizationGuard',
      () => palestrantes.saveSpeakerProfileAction(null, formulario({ tenantSlug, name: 'Nome' })),
    ],
    [
      'speaker.speakerGuard',
      () =>
        palestrantes.updateMySpeakerProfileAction(
          null,
          formulario({ tenantSlug, speakerProfileId: randomUUID(), name: 'Nome do palestrante' }),
        ),
    ],
    [
      'review',
      () =>
        revisao.createSubmissionAction(
          null,
          formulario({
            tenantSlug,
            eventId: evento1,
            trackId: trilha,
            title: 'Título sem sessão',
            abstract: `${'Resumo longo o bastante para passar da validação. '.repeat(4)}`,
            keywords: 'x',
          }),
        ),
    ],
    [
      'raffle',
      () =>
        sorteios.previewRaffleAction(
          null,
          formulario({ tenantSlug, eventId: evento1, scope: 'EVENT', winnersCount: '1' }),
        ),
    ],
    [
      'member',
      () => membros.updateMemberRolesAction(null, formulario({ tenantSlug, userId: randomUUID(), roles: 'ADMIN' })),
    ],
    ['landing', () => landing.ensureHomePageAction(null, formulario({ tenantSlug, eventId: evento1 }))],
    [
      'gamification',
      () => gamificacao.claimMissionAction(null, formulario({ tenantSlug, taskDefinitionId: randomUUID() })),
    ],
    [
      'demand',
      () =>
        demandas.assignDemandAction(
          null,
          formulario({ tenantSlug, eventId: evento1, demandId: demandaDeOutraEquipe }),
        ),
    ],
    [
      'communication',
      () => comunicacao.retryEmailAction(null, formulario({ tenantSlug, emailMessageId: randomUUID() })),
    ],
    [
      'certificate',
      () =>
        certificados.issueEventCertificatesAction(
          null,
          formulario({ tenantSlug, eventId: evento1, kinds: 'ATTENDANCE' }),
        ),
    ],
    [
      'catalog-archive',
      () => catalogo.restoreCardTemplateAction(null, formulario({ tenantSlug, cardTemplateId: randomUUID() })),
    ],
    [
      'bigscreen',
      () =>
        telao.setBigscreenVisibilityAction(
          null,
          formulario({ tenantSlug, eventId: evento1, raffleId: randomUUID(), visible: 'true' }),
        ),
    ],
    ['attendance', () => presenca.checkInAction(null, formulario({ tenantSlug, registrationId: randomUUID() }))],
    [
      'admin',
      () =>
        admin.saveTrackAction(
          null,
          formulario({ tenantSlug, eventId: evento1, slug: `t-${RUN}`, name: 'Trilha' }),
        ),
    ],
  ];

  it.each(casos)('%s devolve NOT_AUTHENTICATED com a mensagem da casa', async (_nome, chamar) => {
    sessao.userId = null;

    await expect(chamar()).resolves.toEqual({
      ok: false,
      code: 'NOT_AUTHENTICATED',
      message: 'Sessão expirada. Entre novamente.',
    });
  });
});
