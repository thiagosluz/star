/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — ARQUIVO E RESTAURAÇÃO DO CATÁLOGO (FASE 51 · dívida E58)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DÍVIDA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A exclusão de carta e de missão é LÓGICA (`deletedAt`) desde a FASE 43, e todas as
 *  leituras filtravam `deletedAt: null`: o item desaparecia das telas e não havia onde
 *  vê-lo de novo — quem excluísse por engano dependia de `UPDATE deleted_at = NULL` no
 *  banco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PROVAM (e o que eles NÃO fingem provar)
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • o catálogo ganhou ESCOPO explícito, e `ATIVOS` continua sendo o padrão — quem
 *      chamava a leitura antes desta fase lê exatamente o mesmo universo;
 *    • excluir tira do catálogo ativo e coloca em arquivados, com DATA e AUTOR vindos
 *      da trilha (uma consulta para a lista, não uma por linha);
 *    • restaurar traz de volta e o item VOLTA A VALER — provado pelo caminho que
 *      concede: o motor de recompensas recusa a carta arquivada e a concede de novo
 *      depois da restauração;
 *    • a trilha guarda as DUAS operações (a exclusão da FASE 43 e a restauração), com
 *      as duas pontas do `deletedAt`;
 *    • a restauração RECUSA o que colidiria com um item ativo de mesmo nome — e o slug
 *      continua reservado enquanto o item está arquivado (o índice único é TOTAL, não
 *      parcial: não há `WHERE deletedAt IS NULL` em lugar nenhum);
 *    • carta arquivada NÃO aparece no álbum de quem não a ganhou nem é concedida por
 *      gatilho nenhum. Ela CONTINUA no álbum de quem já a ganhou — invariante escrito
 *      na FASE 43 e mantido aqui de propósito: uma coleção que apaga o que a pessoa
 *      conquistou não é uma coleção.
 *
 *  Sobre PERMISSÃO: a autorização mora na Server Action (invariante: esconder botão não
 *  é autorização), e uma Server Action não roda fora de uma requisição. O que se testa
 *  aqui é a DECISÃO que a action toma, com a MESMA função (`can`) e a MESMA permissão
 *  que ela usa — `loadPrincipal` + `can`, como nos testes de RBAC da FASE 10.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { loadPrincipal } from '../../src/lib/auth/session';
import { can } from '../../src/domain/rbac/authorization';
import { PERMISSIONS } from '../../src/domain/rbac/permissions';
import {
  catalogScopeFromQuery,
  catalogScopeToggleLabel,
  isCatalogScope,
} from '../../src/domain/gamification/catalog-rules';
import {
  deleteCardTemplate,
  deleteMission,
  listCardTemplates,
  listMissions as listAdminMissions,
  saveCardTemplate,
  saveMission,
} from '../../src/lib/admin/gamification-admin-service';
import { restoreCardTemplate, restoreMission } from '../../src/lib/admin/catalog-archive-service';
import { getAlbum } from '../../src/lib/gamification/card-service';
import { listMissions as listParticipantMissions } from '../../src/lib/gamification/task-service';
import { awardForEvent, grantCardForTrigger } from '../../src/lib/gamification/reward-engine';
import { sequenceRandom } from '../../src/lib/gamification/random';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityId: string;

let organizadora: string;
/** Quem ganha a carta no caminho do motor de recompensas. */
let participante: string;
/** Quem NUNCA a ganhou — é com ele que se prova que o arquivo não vaza para o álbum alheio. */
let semCarta: string;
/** Quem recebe a carta pelo caminho MANUAL (a tela de "conceder carta"). */
let porConcessaoManual: string;
let coordenadoraCientifica: string;

let cartaA: string;
let cartaB: string;
let missao: string;

/** Sorteio determinístico (ver `gamification.test.ts`: a fábrica nasce nova a cada uso). */
function deterministicRandom(): () => number {
  return sequenceRandom([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(name: string, role?: 'ADMIN' | 'CHAIR'): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f51cat.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', kind: 'MEMBER', joinedAt: new Date() },
  });

  if (role) {
    await withTenant(tenantId, (tx) =>
      tx.roleAssignment.create({
        data: { id: randomUUID(), tenantId, userId: id, role, scope: 'TENANT' },
      }),
    );
  }

  return id;
}

async function criarCarta(input: { slug: string; name: string; trigger?: 'CHECKIN' | 'MANUAL_GRANT' }): Promise<string> {
  const result = await saveCardTemplate({
    tenantId,
    actorId: organizadora,
    eventId: null,
    slug: input.slug,
    name: input.name,
    description: null,
    lore: null,
    rarity: 'COMMON',
    trigger: input.trigger ?? 'CHECKIN',
    triggerCondition: {},
    levelRequired: 1,
    dropWeight: 100,
    maxSupply: 0,
    availableUntil: null,
    isActive: true,
    isSecret: false,
    palette: { primary: '#123456' },
    art: {},
  });

  if (!result.ok) throw new Error(`falha ao criar a carta ${input.slug}: ${result.message}`);

  return result.cardTemplateId;
}

async function criarMissao(slug: string, name: string): Promise<string> {
  const result = await saveMission({
    tenantId,
    actorId: organizadora,
    eventId,
    slug,
    name,
    description: null,
    kind: 'ONE_OFF',
    trigger: 'CHECKIN',
    target: { count: 3 },
    xpReward: 50,
    rewardCardTemplateId: null,
    startsAt: null,
    endsAt: null,
    repeatEveryHours: 0,
    isActive: true,
    isVisible: true,
    displayOrder: 0,
  });

  if (!result.ok) throw new Error(`falha ao criar a missão ${slug}: ${result.message}`);

  return result.taskDefinitionId;
}

/** Check-in que passa pelo MOTOR — é o caminho que concede cartas. */
async function checkin(userId: string, chave: string) {
  return awardForEvent({
    tenantId,
    userId,
    source: 'CHECKIN',
    idempotencyKey: chave,
    eventId,
    activityId,
    random: deterministicRandom(),
  });
}

async function lerCarta(id: string) {
  return withTenant(tenantId, (tx) =>
    tx.cardTemplate.findUniqueOrThrow({
      where: { id },
      select: { deletedAt: true, isActive: true, slug: true, name: true },
    }),
  );
}

async function lerMissao(id: string) {
  return withTenant(tenantId, (tx) =>
    tx.taskDefinition.findUniqueOrThrow({
      where: { id },
      select: { deletedAt: true, isActive: true, isVisible: true },
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  activityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `arquivo-${RUN}`,
      name: `Instituição do Arquivo ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-arquivo-${RUN}`,
        title: 'Congresso do Arquivo',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: `atividade-${RUN}`,
        title: 'Abertura',
        type: 'LECTURE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        workloadMinutes: 60,
        capacity: null,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
      },
    });
  });

  organizadora = await createUser('Organizadora do Catálogo', 'ADMIN');
  coordenadoraCientifica = await createUser('Coordenadora Científica', 'CHAIR');
  participante = await createUser('Participante que Ganha');
  semCarta = await createUser('Participante Sem a Carta');
  porConcessaoManual = await createUser('Participante da Concessão Manual');

  cartaA = await criarCarta({ slug: `carta-a-${RUN}`, name: 'Carta de Boas-vindas' });
  /**
   * A `cartaB` serve a DOIS cenários e por isso tem nome PRÓPRIO: o gatilho
   * `MANUAL_GRANT` mantém o pool de `CHECKIN` com UMA carta só (o teste do motor
   * precisa ser determinístico), e é ela que sofre a colisão de nome — colisão que só
   * nasce DEPOIS do arquivamento, quando alguém cria uma carta nova com o mesmo nome.
   */
  cartaB = await criarCarta({
    slug: `carta-b-${RUN}`,
    name: 'Carta Reserva',
    trigger: 'MANUAL_GRANT',
  });
  missao = await criarMissao(`missao-${RUN}`, 'Presença tripla');
});

afterAll(async () => {
  await adminPrisma.auditLog.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o escopo do catálogo é um valor, e `ATIVOS` continua sendo o padrão', () => {
  it('o parâmetro da query só abre o arquivo com o marcador explícito', () => {
    expect(catalogScopeFromQuery('1')).toBe('ARQUIVADOS');
    expect(catalogScopeFromQuery(['1'])).toBe('ARQUIVADOS');
    expect(catalogScopeFromQuery(undefined)).toBe('ATIVOS');
    expect(catalogScopeFromQuery('0')).toBe('ATIVOS');
    expect(catalogScopeFromQuery('')).toBe('ATIVOS');
    expect(catalogScopeFromQuery('arquivados')).toBe('ATIVOS');
    expect(isCatalogScope('ARQUIVADOS')).toBe(true);
    expect(isCatalogScope('arquivado')).toBe(false);
    expect(catalogScopeToggleLabel('ATIVOS')).toMatch(/arquivad/i);
    expect(catalogScopeToggleLabel('ARQUIVADOS')).toMatch(/voltar/i);
  });

  it('as duas leituras falam de universos diferentes — e a de sempre é a ativa', async () => {
    const ativos = await listCardTemplates(tenantId);
    const arquivados = await listCardTemplates(tenantId, 'ARQUIVADOS');

    expect(ativos.map((card) => card.id)).toEqual(expect.arrayContaining([cartaA, cartaB]));
    expect(arquivados).toEqual([]);

    /** Quem chamava sem escopo continua lendo o mesmo universo. */
    const semEscopo = await listCardTemplates(tenantId);
    expect(semEscopo.map((card) => card.id)).toEqual(ativos.map((card) => card.id));

    /** E nada vem com data de arquivamento enquanto nada foi arquivado. */
    expect(ativos.every((card) => card.archivedAt === null && card.archivedByName === null)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('excluir tira do catálogo ativo e coloca no arquivo, com data e autor', () => {
  it('a carta sai da lista ativa e aparece na de arquivados', async () => {
    const exclusao = await deleteCardTemplate({
      tenantId,
      actorId: organizadora,
      cardTemplateId: cartaA,
    });

    expect(exclusao.ok).toBe(true);

    const ativos = await listCardTemplates(tenantId);
    expect(ativos.map((card) => card.id)).not.toContain(cartaA);

    const arquivados = await listCardTemplates(tenantId, 'ARQUIVADOS');
    const arquivada = arquivados.find((card) => card.id === cartaA);

    expect(arquivada).toBeDefined();
    /** A trilha explica o item: quando e por quem — sem uma consulta por linha. */
    expect(arquivada?.archivedAt).toBeInstanceOf(Date);
    expect(arquivada?.archivedByName).toBe('Organizadora do Catálogo');
  });

  it('o banco confirma a exclusão LÓGICA: a linha continua lá', async () => {
    const carta = await lerCarta(cartaA);

    expect(carta.deletedAt).not.toBeNull();
    expect(carta.isActive).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('enquanto arquivada, a carta não vale em lugar nenhum', () => {
  it('não está no álbum de quem NÃO a ganhou', async () => {
    const album = await getAlbum(tenantId, semCarta);

    expect(album.ok).toBe(true);
    if (!album.ok) return;

    expect(album.cards.map((card) => card.templateId)).not.toContain(cartaA);
  });

  it('o motor de recompensas NÃO a concede, mesmo com o gatilho acontecendo', async () => {
    const premiacao = await checkin(participante, `f51-antes-${RUN}`);

    expect(premiacao.ok).toBe(true);
    if (!premiacao.ok) return;

    expect(premiacao.cards.map((card) => card.templateId)).not.toContain(cartaA);
    /** `cartaA` é a ÚNICA carta de `CHECKIN` ativa — o pool vazio é a prova inteira. */
    expect(premiacao.cards).toEqual([]);
  });

  it('nem a concessão MANUAL alcança a carta arquivada', async () => {
    /**
     * O caminho manual (a tela de "conceder carta") passa pelo mesmo `loadCandidates` do
     * motor — e é isso que faz o filtro valer "em todo lugar": não existe uma segunda
     * consulta de carta que pudesse esquecer o `deletedAt`.
     */
    const manual = await grantCardForTrigger({
      tenantId,
      userId: semCarta,
      /** O gatilho da própria carta: o ÚNICO motivo da recusa é ela estar arquivada. */
      trigger: 'CHECKIN',
      templateId: cartaA,
      actorId: organizadora,
    });

    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    expect(manual.cards).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('restaurar', () => {
  it('traz a carta de volta ao catálogo ativo', async () => {
    const restauracao = await restoreCardTemplate({
      tenantId,
      actorId: organizadora,
      cardTemplateId: cartaA,
    });

    expect(restauracao.ok).toBe(true);
    if (!restauracao.ok) return;

    expect(restauracao.name).toBe('Carta de Boas-vindas');
    /** O serviço também informa quem a havia arquivado — a tela mostra isso antes. */
    expect(restauracao.archivedByName).toBe('Organizadora do Catálogo');

    const carta = await lerCarta(cartaA);
    expect(carta.deletedAt).toBeNull();
    expect(carta.isActive).toBe(true);

    const ativos = await listCardTemplates(tenantId);
    expect(ativos.map((card) => card.id)).toContain(cartaA);

    const arquivados = await listCardTemplates(tenantId, 'ARQUIVADOS');
    expect(arquivados.map((card) => card.id)).not.toContain(cartaA);
  });

  it('a carta VOLTA A VALER: o motor a concede de novo', async () => {
    const premiacao = await checkin(participante, `f51-depois-${RUN}`);

    expect(premiacao.ok).toBe(true);
    if (!premiacao.ok) return;

    expect(premiacao.cards.map((card) => card.templateId)).toContain(cartaA);
  });

  it('a concessão MANUAL também volta a alcançá-la', async () => {
    /**
     * O par importa: antes da restauração a mesma chamada devolvia `cards: []` — e sem
     * esta metade o teste de recusa poderia estar passando por outro motivo qualquer
     * (tiragem, gatilho, nível). Aqui a ÚNICA diferença é a carta estar ativa de novo.
     */
    const manual = await grantCardForTrigger({
      tenantId,
      userId: porConcessaoManual,
      trigger: 'CHECKIN',
      templateId: cartaA,
      actorId: organizadora,
    });

    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    expect(manual.cards.map((card) => card.templateId)).toEqual([cartaA]);
  });

  it('a trilha guarda as DUAS operações, com as duas pontas do `deletedAt`', async () => {
    const trilha = await adminPrisma.auditLog.findMany({
      where: {
        tenantId,
        entityType: 'card_template',
        entityId: cartaA,
        action: { in: ['DELETE', 'UPDATE'] },
      },
      orderBy: { createdAt: 'asc' },
      select: { action: true, changes: true },
    });

    expect(trilha).toHaveLength(2);
    expect(trilha[0]?.action).toBe('DELETE');
    expect(trilha[1]?.action).toBe('UPDATE');

    const exclusao = trilha[0]?.changes as Record<string, { from: unknown; to: unknown }>;
    const restauracao = trilha[1]?.changes as Record<string, { from: unknown; to: unknown }>;

    /** A ponta que SAI: a data em que foi arquivada (a trilha guarda o ISO). */
    expect(typeof restauracao.deletedAt?.from).toBe('string');
    /** A ponta que ENTRA: nulo — o item está ativo de novo. */
    expect(restauracao.deletedAt?.to).toBeNull();
    expect(restauracao.estado).toEqual({ from: 'arquivada', to: 'ativa' });
    expect(restauracao.name).toEqual({ from: null, to: 'Carta de Boas-vindas' });
    /** E a ponta da EXCLUSÃO, do outro lado da mesma trilha. */
    expect(exclusao.name).toEqual({ from: 'Carta de Boas-vindas', to: null });
  });

  it('restaurar o que já está ativo é resposta de negócio, não erro', async () => {
    const denovo = await restoreCardTemplate({
      tenantId,
      actorId: organizadora,
      cardTemplateId: cartaA,
    });

    expect(denovo.ok).toBe(false);
    if (denovo.ok) return;
    expect(denovo.code).toBe('ALREADY_ACTIVE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a restauração não ressuscita o que colidiria com um ativo', () => {
  it('o NOME já ocupado por outra carta ativa é recusado, com o motivo escrito', async () => {
    const exclusao = await deleteCardTemplate({
      tenantId,
      actorId: organizadora,
      cardTemplateId: cartaB,
    });

    expect(exclusao.ok).toBe(true);

    /**
     * O nome de carta NÃO é único em lugar nenhum — só o slug é. Enquanto a `cartaB`
     * está arquivada, criar outra com o MESMO nome é permitido (e é o caminho real: a
     * organização refaz a carta sem perceber que a antiga ainda existe no arquivo).
     */
    const nova = await criarCarta({
      slug: `carta-c-${RUN}`,
      name: 'Carta Reserva',
      trigger: 'MANUAL_GRANT',
    });

    const tentativa = await restoreCardTemplate({
      tenantId,
      actorId: organizadora,
      cardTemplateId: cartaB,
    });

    expect(tentativa.ok).toBe(false);
    if (tentativa.ok) return;

    expect(tentativa.code).toBe('ARCHIVE_CONFLICT');
    expect(tentativa.message).toContain('Carta Reserva');

    /** E a carta arquivada CONTINUA arquivada: a recusa não deixou meia-restauração. */
    const carta = await lerCarta(cartaB);
    expect(carta.deletedAt).not.toBeNull();

    /**
     * O catálogo ativo tem UMA carta com esse nome — a nova, e não duas: a restauração
     * NÃO acrescentou a arquivada à lista.
     */
    const ativos = await listCardTemplates(tenantId);
    expect(
      ativos.filter((card) => card.name === 'Carta Reserva').map((card) => card.id).sort(),
    ).toEqual([nova]);
    expect(ativos.map((card) => card.id)).not.toContain(cartaB);
  });

  it('o SLUG continua reservado enquanto a carta está arquivada (o índice único é TOTAL)', async () => {
    /**
     * Não existe índice único PARCIAL com `WHERE deletedAt IS NULL` em `card_templates`
     * — a unicidade é `(tenantId, slug)` para todas as linhas. Consequência honesta: o
     * slug de uma carta arquivada NÃO pode ser reaproveitado por uma carta nova, e por
     * isso a restauração nunca colide em slug (ela é a MESMA linha). O teste prende o
     * fato: o dia em que alguém tornar o índice parcial, este teste cai e a decisão é
     * tomada de novo — em vez de a colisão aparecer num 500 de banco.
     */
    const resultado = await saveCardTemplate({
      tenantId,
      actorId: organizadora,
      eventId: null,
      slug: `carta-b-${RUN}`,
      name: 'Outra carta qualquer',
      description: null,
      lore: null,
      rarity: 'COMMON',
      trigger: 'CHECKIN',
      triggerCondition: {},
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 0,
      availableUntil: null,
      isActive: true,
      isSecret: false,
      palette: {},
      art: {},
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe('SLUG_TAKEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a carta arquivada que alguém JÁ ganhou continua no álbum dessa pessoa', () => {
  it('arquivar de novo tira do catálogo e NÃO tira de quem conquistou', async () => {
    /** `participante` ganhou a `cartaA` no teste "volta a valer" (acima). */
    const antes = await getAlbum(tenantId, participante);
    if (!antes.ok) throw new Error(antes.message);
    expect(antes.cards.map((card) => card.templateId)).toContain(cartaA);

    const exclusao = await deleteCardTemplate({
      tenantId,
      actorId: organizadora,
      cardTemplateId: cartaA,
    });
    expect(exclusao.ok).toBe(true);

    const depois = await getAlbum(tenantId, participante);
    if (!depois.ok) throw new Error(depois.message);

    /** Invariante da FASE 43, mantido: a coleção de quem ganhou não é apagada. */
    expect(depois.cards.map((card) => card.templateId)).toContain(cartaA);

    /** Quem NUNCA a ganhou continua sem vê-la. */
    const semEla = await getAlbum(tenantId, semCarta);
    if (!semEla.ok) throw new Error(semEla.message);
    expect(semEla.cards.map((card) => card.templateId)).not.toContain(cartaA);

    /**
     * A trilha registra quantas pessoas mantêm a carta no álbum — é o número que
     * justifica a exclusão ser lógica. Ele é CONFERIDO contra o banco, e não fixado no
     * teste: a pergunta é "a trilha concorda com o álbum?", não "hoje existem N álbuns".
     */
    const donos = await withTenant(tenantId, (tx) =>
      tx.userCard.count({ where: { tenantId, cardTemplateId: cartaA } }),
    );

    const trilha = await adminPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'card_template', entityId: cartaA, action: 'DELETE' },
      orderBy: { createdAt: 'desc' },
      select: { changes: true },
    });

    const changes = trilha[0]?.changes as Record<string, { from: unknown; to: unknown }>;
    expect(donos).toBeGreaterThan(0);
    expect(changes.noAlbumDe?.to).toBe(String(donos));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('missões: o mesmo caminho, com o progresso preservado', () => {
  it('excluir some da lista do participante; restaurar traz de volta', async () => {
    const antes = await listParticipantMissions(tenantId, semCarta);
    if (!antes.ok) throw new Error(antes.message);
    expect(antes.missions.map((mission) => mission.taskDefinitionId)).toContain(missao);

    const exclusao = await deleteMission({ tenantId, actorId: organizadora, taskDefinitionId: missao });
    expect(exclusao.ok).toBe(true);

    const arquivados = await listAdminMissions(tenantId, 'ARQUIVADOS');
    const arquivada = arquivados.find((row) => row.id === missao);
    expect(arquivada?.archivedAt).toBeInstanceOf(Date);
    expect(arquivada?.archivedByName).toBe('Organizadora do Catálogo');

    const durante = await listParticipantMissions(tenantId, semCarta);
    if (!durante.ok) throw new Error(durante.message);
    expect(durante.missions.map((mission) => mission.taskDefinitionId)).not.toContain(missao);

    /** O progresso de quem já avançou SOBREVIVE à exclusão (FASE 43). */
    await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.create({
        data: {
          id: randomUUID(),
          tenantId,
          userId: semCarta,
          taskDefinitionId: missao,
          status: 'COMPLETED',
          progress: 3,
          target: 3,
          periodKey: `f51-${RUN}`,
          completedAt: new Date(),
        },
      }),
    );

    const restauracao = await restoreMission({
      tenantId,
      actorId: organizadora,
      taskDefinitionId: missao,
    });

    expect(restauracao.ok).toBe(true);
    if (!restauracao.ok) return;
    expect(restauracao.name).toBe('Presença tripla');

    const missaoAtiva = await lerMissao(missao);
    expect(missaoAtiva.deletedAt).toBeNull();
    expect(missaoAtiva.isActive).toBe(true);
    expect(missaoAtiva.isVisible).toBe(true);

    const depois = await listParticipantMissions(tenantId, semCarta);
    if (!depois.ok) throw new Error(depois.message);
    expect(depois.missions.map((mission) => mission.taskDefinitionId)).toContain(missao);

    const progresso = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.findFirstOrThrow({
        where: { tenantId, userId: semCarta, taskDefinitionId: missao },
        select: { status: true, progress: true, periodKey: true },
      }),
    );

    expect(progresso.status).toBe('COMPLETED');
    expect(progresso.progress).toBe(3);
  });

  it('a missão também tem escopo: a lista ativa não a mostra quando arquivada', async () => {
    const exclusao = await deleteMission({ tenantId, actorId: organizadora, taskDefinitionId: missao });
    expect(exclusao.ok).toBe(true);

    const ativos = await listAdminMissions(tenantId);
    expect(ativos.map((row) => row.id)).not.toContain(missao);

    const arquivados = await listAdminMissions(tenantId, 'ARQUIVADOS');
    expect(arquivados.map((row) => row.id)).toContain(missao);

    const restauracao = await restoreMission({
      tenantId,
      actorId: organizadora,
      taskDefinitionId: missao,
    });
    expect(restauracao.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('autorização: quem pode excluir pode restaurar — e quem não pode, não', () => {
  it('a permissão da restauração é a MESMA da exclusão', async () => {
    const organizadoraPrincipal = await loadPrincipal(organizadora, tenantId, 'ACTIVE');
    const cientifica = await loadPrincipal(coordenadoraCientifica, tenantId, 'ACTIVE');

    /** A action usa exatamente estas duas permissões, no escopo da instituição. */
    expect(can(organizadoraPrincipal, PERMISSIONS.CARD_TEMPLATE_MANAGE, { scope: 'TENANT' })).toBe(true);
    expect(can(organizadoraPrincipal, PERMISSIONS.TASK_MANAGE, { scope: 'TENANT' })).toBe(true);

    /**
     * A CHAIR coordena a trilha científica: decide parecer, não opera o catálogo de
     * gamificação. Ela NÃO restaura — e o botão escondido na tela não é a razão: a
     * Server Action recusa antes de tocar no dado.
     */
    expect(can(cientifica, PERMISSIONS.CARD_TEMPLATE_MANAGE, { scope: 'TENANT' })).toBe(false);
    expect(can(cientifica, PERMISSIONS.TASK_MANAGE, { scope: 'TENANT' })).toBe(false);
  });

  it('o serviço recusa restaurar item de OUTRA instituição', async () => {
    const outraInstituicao = randomUUID();

    const resultado = await restoreCardTemplate({
      tenantId: outraInstituicao,
      actorId: organizadora,
      cardTemplateId: cartaA,
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.code).toBe('NOT_FOUND');
  });
});
