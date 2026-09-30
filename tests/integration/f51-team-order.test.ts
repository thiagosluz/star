/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — ORDEM MANUAL DAS EQUIPES NA VITRINE (FASE 51 · E63)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • mudar a ordem pela APLICAÇÃO (o mesmo serviço que a Server Action chama)
 *      reflete na leitura da página pública — e a lista da tela de equipes passa a
 *      mostrar a mesma sequência;
 *    • a reescrita grava 10, 20, 30… em TODAS as equipes do evento, sem empate (é o
 *      que impede o movimento de virar no-op);
 *    • **equipe desativada continua fora** da vitrine, mesmo ordenada;
 *    • **quem perdeu o vínculo com a instituição continua saindo** — a linha da
 *      equipe fica (o quadro de demandas depende dela) e o nome não vai para a
 *      internet;
 *    • uma lista PARCIAL é recusada: reordenar "só a equipe que eu mexi" mudaria as
 *      outras em silêncio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import {
  createEventTeam,
  loadEventTeamOrder,
  reorderEventTeams,
} from '../../src/lib/events/demand-service';
import { moveWithinList } from '../../src/domain/events/demand-rules';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-ordem-${RUN}`;

let tenantId: string;
let eventId: string;
let organizadora: string;
let bruno: string;
let carla: string;
let diego: string;
let quemSaiu: string;

let presidencia: string;
let programacao: string;
let apoio: string;
let antiga: string;

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f51ordem.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

async function addMember(userId: string, status: 'ACTIVE' | 'REMOVED' = 'ACTIVE'): Promise<void> {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status,
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });
}

async function createTeam(input: {
  name: string;
  memberIds: string[];
  leadId?: string | null;
}): Promise<string> {
  const result = await createEventTeam({
    tenantId,
    eventId,
    actorId: organizadora,
    name: input.name,
    description: null,
    memberIds: input.memberIds,
    leadId: input.leadId ?? null,
  });

  if (!result.ok) throw new Error(`falha ao criar a equipe ${input.name}: ${result.message}`);

  return result.teamId;
}

/** A ordem das equipes como a VITRINE pública a entrega. */
async function vitrineTeamNames(): Promise<string[]> {
  const event = await getPublicEvent(tenantId, EVENT_SLUG);
  if (!event) throw new Error('evento não encontrado');

  return event.teams.map((team) => team.name);
}

/** Os cartões da vitrine, na ordem em que a página os desenha. */
async function vitrineCardNames(): Promise<string[]> {
  const event = await getPublicEvent(tenantId, EVENT_SLUG);
  if (!event) throw new Error('evento não encontrado');

  return event.organizers.map((card) => card.name);
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `ordem-equipes-${RUN}`,
      name: `Instituição da Ordem ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: 'Congresso da Ordem',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        confirmedCount: 0,
      },
    }),
  );

  organizadora = await createUser('Ana Souza');
  bruno = await createUser('Bruno Lima');
  carla = await createUser('Carla Nunes');
  diego = await createUser('Diego Prado');
  quemSaiu = await createUser('Quem Saiu');

  await addMember(organizadora);
  await addMember(bruno);
  await addMember(carla);
  await addMember(diego);
  /**
   * `quemSaiu` entra como ATIVA (só vínculo ativo entra em equipe, e é assim que a
   * linha da equipe nasce de verdade). O vínculo é removido DEPOIS, que é a ordem real
   * dos fatos: a pessoa trabalhou, foi colocada na equipe e depois saiu da instituição
   * (FASE 21) — o vínculo de equipe do evento não é revogado junto.
   */
  await addMember(quemSaiu);

  presidencia = await createTeam({
    name: 'Presidência',
    memberIds: [organizadora, quemSaiu],
    leadId: organizadora,
  });

  await adminPrisma.userTenantProfile.updateMany({
    where: { tenantId, userId: quemSaiu },
    data: { status: 'REMOVED', deletedAt: new Date() },
  });

  programacao = await createTeam({
    name: 'Programação',
    memberIds: [bruno, carla],
    leadId: bruno,
  });

  apoio = await createTeam({ name: 'Apoio', memberIds: [diego] });

  /** Equipe DESATIVADA: existe no quadro, não é vitrine. */
  antiga = await createTeam({ name: 'Equipe antiga', memberIds: [diego] });

  await withTenant(tenantId, (tx) =>
    tx.eventTeam.update({ where: { id: antiga }, data: { isActive: false } }),
  );
});

afterAll(async () => {
  await adminPrisma.auditLog.deleteMany({ where: { tenantId } });
  await adminPrisma.roleAssignment.deleteMany({ where: { tenantId } });
  await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId } });
  await adminPrisma.event.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sem ordem definida, a vitrine mantém a ordem que já existia', () => {
  it('as equipes saem em ordem alfabética e os cartões seguem o líder primeiro', async () => {
    expect(await vitrineTeamNames()).toEqual(['Apoio', 'Presidência', 'Programação']);

    /** Apoio (Diego) → Presidência (Ana, líder) → Programação (Bruno líder, Carla). */
    expect(await vitrineCardNames()).toEqual([
      'Diego Prado',
      'Ana Souza',
      'Bruno Lima',
      'Carla Nunes',
    ]);
  });

  it('a tela de equipes vê a MESMA ordem da vitrine', async () => {
    const loaded = await loadEventTeamOrder({ tenantId, eventId });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    /** A equipe desativada entra na lista de ADMINISTRAÇÃO — ela existe e é gerenciável. */
    expect(loaded.teams.map((team) => team.name)).toEqual([
      'Apoio',
      'Equipe antiga',
      'Presidência',
      'Programação',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('mudar a ordem pela aplicação reflete na vitrine', () => {
  it('reescreve 10, 20, 30… e a página pública obedece', async () => {
    const result = await reorderEventTeams({
      tenantId,
      eventId,
      actorId: organizadora,
      teamIds: [presidencia, programacao, apoio, antiga],
    });

    expect(result.ok).toBe(true);

    const gravado = await withTenant(tenantId, (tx) =>
      tx.eventTeam.findMany({
        where: { tenantId, eventId },
        select: { id: true, displayOrder: true },
      }),
    );

    const porId = new Map(gravado.map((row) => [row.id, row.displayOrder]));
    expect(porId.get(presidencia)).toBe(10);
    expect(porId.get(programacao)).toBe(20);
    expect(porId.get(apoio)).toBe(30);
    expect(porId.get(antiga)).toBe(40);

    /** A ordem manual venceu o alfabeto. */
    expect(await vitrineTeamNames()).toEqual(['Presidência', 'Programação', 'Apoio']);
    expect(await vitrineCardNames()).toEqual([
      'Ana Souza',
      'Bruno Lima',
      'Carla Nunes',
      'Diego Prado',
    ]);
  });

  it('a trilha guarda a ordem — uma entrada, não uma por equipe', async () => {
    const trilha = await adminPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'EventTeam', action: 'UPDATE' },
      select: { entityId: true, changes: true },
    });

    expect(trilha).toHaveLength(1);
    expect(trilha[0]?.entityId).toBe(eventId);
    expect(JSON.stringify(trilha[0]?.changes)).toContain(presidencia);
  });

  it('o movimento de UMA casa (o cálculo da tela) chega à vitrine', async () => {
    const loaded = await loadEventTeamOrder({ tenantId, eventId });
    if (!loaded.ok) throw new Error(loaded.message);

    const ids = loaded.teams.map((team) => team.id);
    const index = ids.indexOf(apoio);
    expect(index).toBe(2);

    /** "Subir uma casa" é o que `moveWithinList` faz — a MESMA função que a action usa. */
    const movido = await reorderEventTeams({
      tenantId,
      eventId,
      actorId: organizadora,
      teamIds: moveWithinList(ids, index, index - 1),
    });

    expect(movido.ok).toBe(true);
    expect(await vitrineTeamNames()).toEqual(['Presidência', 'Apoio', 'Programação']);
  });

  it('equipe NOVA (sem ordem) entra no FIM — não no meio da lista montada', async () => {
    const comunicacao = await createTeam({ name: 'Comunicação', memberIds: [carla, diego] });

    const loaded = await loadEventTeamOrder({ tenantId, eventId });
    if (!loaded.ok) throw new Error(loaded.message);

    expect(loaded.teams[loaded.teams.length - 1]?.id).toBe(comunicacao);
    expect(await vitrineTeamNames()).toEqual([
      'Presidência',
      'Apoio',
      'Programação',
      'Comunicação',
    ]);
  });

  it('lista parcial é RECUSADA — reordenar um subconjunto mudaria as outras em silêncio', async () => {
    const antes = await withTenant(tenantId, (tx) =>
      tx.eventTeam.findMany({
        where: { tenantId, eventId },
        orderBy: { id: 'asc' },
        select: { id: true, displayOrder: true },
      }),
    );

    const result = await reorderEventTeams({
      tenantId,
      eventId,
      actorId: organizadora,
      teamIds: [apoio, presidencia],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');

    const depois = await withTenant(tenantId, (tx) =>
      tx.eventTeam.findMany({
        where: { tenantId, eventId },
        orderBy: { id: 'asc' },
        select: { id: true, displayOrder: true },
      }),
    );

    expect(depois).toEqual(antes);
  });

  it('ordem de OUTRO evento não contamina esta vitrine', async () => {
    const outroEvento = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.event.create({
        data: {
          id: outroEvento,
          tenantId,
          slug: `outro-evento-${RUN}`,
          title: 'Outro evento',
          status: 'REGISTRATION_OPEN',
          modality: 'ONLINE',
          timezone: 'America/Bahia',
          startsAt: new Date(Date.now() + 10 * 86_400_000),
          endsAt: new Date(Date.now() + 11 * 86_400_000),
          confirmedCount: 0,
        },
      }),
    );

    const outraEquipe = await createEventTeam({
      tenantId,
      eventId: outroEvento,
      actorId: organizadora,
      name: 'Equipe de fora',
      memberIds: [diego],
      leadId: null,
    });

    if (!outraEquipe.ok) throw new Error(outraEquipe.message);

    /**
     * A reescrita do OUTRO evento não pode exigir as equipes deste — a guarda é a lista
     * do evento, e não a da instituição.
     */
    const fora = await reorderEventTeams({
      tenantId,
      eventId: outroEvento,
      actorId: organizadora,
      teamIds: [outraEquipe.teamId],
    });

    expect(fora.ok).toBe(true);
    expect(await vitrineTeamNames()).not.toContain('Equipe de fora');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('as duas guardas da vitrine continuam valendo com ordem manual', () => {
  it('equipe desativada continua fora — mesmo ordenada em primeiro lugar', async () => {
    const loaded = await loadEventTeamOrder({ tenantId, eventId });
    if (!loaded.ok) throw new Error(loaded.message);

    const ids = loaded.teams.map((team) => team.id);
    const semAntiga = ids.filter((id) => id !== antiga);

    await reorderEventTeams({
      tenantId,
      eventId,
      actorId: organizadora,
      teamIds: [antiga, ...semAntiga],
    });

    const gravado = await withTenant(tenantId, (tx) =>
      tx.eventTeam.findUniqueOrThrow({ where: { id: antiga }, select: { displayOrder: true } }),
    );

    /** Ela está em primeiro na ordem… */
    expect(gravado.displayOrder).toBe(10);

    /** …e continua sem aparecer na página pública — nem como equipe, nem como etiqueta. */
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    expect(event.teams.map((team) => team.name)).not.toContain('Equipe antiga');
    expect(event.organizers.flatMap((card) => card.labels)).not.toContain('Equipe antiga');
  });

  it('quem perdeu o vínculo com a instituição continua saindo da vitrine', async () => {
    /** A linha da equipe existe (o quadro de demandas depende dela)… */
    const naEquipe = await withTenant(tenantId, (tx) =>
      tx.eventTeamMember.count({ where: { tenantId, userId: quemSaiu } }),
    );
    expect(naEquipe).toBe(1);

    /** …e o nome dela não vai para a internet. */
    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    if (!event) throw new Error('evento não encontrado');

    expect(event.organizers.map((card) => card.userId)).not.toContain(quemSaiu);
    expect(JSON.stringify(event.organizers)).not.toContain('Quem Saiu');
  });
});
