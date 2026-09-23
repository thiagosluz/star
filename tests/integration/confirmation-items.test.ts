import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveActivity } from '../../src/lib/admin/catalog-service';
import { registerForActivity } from '../../src/lib/events/registration-service';
import {
  listConfirmationQueue,
  resolveConfirmationItem,
  runConfirmationExpirySweep,
} from '../../src/lib/events/confirmation-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let organizerId: string;

const eventSlug = `evento-itens-${RUN}`;
const now = new Date();
const eventStartsAt = new Date(now.getTime() + 30 * 86_400_000);

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Confirmação de vaga POR ITEM (FASE 37 — dívida E48) — integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o checklist nasce com a inscrição RETIDA, na ordem declarada, com o `required` de
 *    cada linha — e **não** nasce em atividade de confirmação automática (lá não há o
 *    que conferir no balcão);
 *  • marcar UM item não confirma a vaga; marcar o ÚLTIMO obrigatório confirma — pelo
 *    caminho de sempre, com autor, trilha e recibo (uma confirmação só no sistema);
 *  • `WAIVED` resolve tanto quanto `RECEIVED`, e o opcional pendente NÃO segura a vaga;
 *  • a escrita do item é CONDICIONAL: dois cliques no balcão produzem um efeito só;
 *  • a RLS responde "não existe" para o item da instituição vizinha, e a fila da equipe
 *    devolve o checklist de cada inscrição.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f37.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

async function createActivity(input: {
  slug: string;
  capacity?: number | null;
  waitlistEnabled?: boolean;
  policy?: 'AUTO' | 'REQUIRED';
  requirements?: unknown;
}): Promise<string> {
  const result = await saveActivity({
    tenantId,
    actorId: organizerId,
    eventId,
    slug: input.slug,
    title: `Oficina ${input.slug}`,
    type: 'WORKSHOP',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: eventStartsAt,
    endsAt: new Date(eventStartsAt.getTime() + 3 * 3_600_000),
    workloadMinutes: 180,
    capacity: input.capacity ?? 10,
    waitlistEnabled: input.waitlistEnabled ?? false,
    requiresRegistration: true,
    confirmationPolicy: input.policy ?? 'REQUIRED',
    confirmationWindowDays: 3,
    confirmationRequirements: input.requirements ?? [
      { kind: 'PAYMENT', label: 'Taxa de R$ 30', note: 'Pix na secretaria' },
      { kind: 'DONATION', label: '1 kg de alimento', note: null, required: false },
      { kind: 'ITEM', label: 'Brinquedo novo', note: null },
    ],
    confirmationPlace: 'Secretaria do bloco B',
  });

  if (!result.ok) throw new Error(`Falha ao criar a atividade: ${result.message}`);

  return result.activityId;
}

async function register(activitySlug: string, userId: string) {
  const result = await registerForActivity({
    tenantId,
    eventSlug,
    activitySlug,
    userId,
  });

  if (!result.ok) throw new Error(`Falha na inscrição: ${result.message}`);

  return result;
}

async function itemsOf(registrationId: string) {
  return withTenant(tenantId, (tx) =>
    tx.registrationConfirmationItem.findMany({
      where: { registrationId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        position: true,
        label: true,
        required: true,
        status: true,
        resolvedById: true,
        resolutionNote: true,
      },
    }),
  );
}

async function statusOf(registrationId: string): Promise<string> {
  const row = await withTenant(tenantId, (tx) =>
    tx.registration.findFirstOrThrow({
      where: { id: registrationId },
      select: { status: true, confirmedById: true },
    }),
  );

  return `${row.status}:${row.confirmedById ?? '-'}`;
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f37-${RUN}`,
        name: `Instituição dos Itens ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f37-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  organizerId = await createUser('Organizadora F37');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: 'Congresso com checklist',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: eventStartsAt,
        endsAt: new Date(eventStartsAt.getTime() + 2 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f37.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o checklist nasce com a inscrição', () => {
  it('a inscrição RETIDA ganha uma linha por exigência, na ordem, com o obrigatório de cada uma', async () => {
    await createActivity({ slug: `snapshot-${RUN}` });

    const pessoa = await createUser('Pessoa do snapshot');
    const inscricao = await register(`snapshot-${RUN}`, pessoa);

    expect(inscricao.status).toBe('PENDING');

    const items = await itemsOf(inscricao.registrationId);

    expect(items.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(items.map((item) => item.label)).toEqual([
      'Taxa de R$ 30',
      '1 kg de alimento',
      'Brinquedo novo',
    ]);
    expect(items.map((item) => item.required)).toEqual([true, false, true]);
    expect(items.every((item) => item.status === 'PENDING')).toBe(true);
    expect(items.every((item) => item.resolvedById === null)).toBe(true);
  });

  it('atividade de confirmação AUTOMÁTICA não cria checklist', async () => {
    await createActivity({ slug: `sem-checklist-${RUN}`, policy: 'AUTO' });

    const pessoa = await createUser('Pessoa da automática');
    const inscricao = await register(`sem-checklist-${RUN}`, pessoa);

    expect(inscricao.status).toBe('CONFIRMED');
    expect(await itemsOf(inscricao.registrationId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a equipe marca item por item no balcão', () => {
  let registrationId: string;

  beforeAll(async () => {
    const pessoa = await createUser('Pessoa do balcão');
    const inscricao = await register(`snapshot-${RUN}`, pessoa);
    registrationId = inscricao.registrationId;
  });

  it('marcar o PRIMEIRO obrigatório não confirma a vaga e diz o que ainda falta', async () => {
    const items = await itemsOf(registrationId);

    const result = await resolveConfirmationItem({
      tenantId,
      registrationId,
      itemId: items[0]!.id,
      status: 'RECEIVED',
      actorId: organizerId,
      note: 'Pago em dinheiro',
      ipAddress: '203.0.113.20',
      userAgent: 'teste-f37',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.autoConfirmed).toBe(false);
    expect(result.summary).toBe('1 de 3 itens');
    expect(result.missingMessage).toContain('Brinquedo novo');

    /** A vaga continua RETIDA: um item recebido não é a confirmação. */
    expect(await statusOf(registrationId)).toBe('PENDING:-');

    const depois = await itemsOf(registrationId);
    expect(depois[0]!.status).toBe('RECEIVED');
    expect(depois[0]!.resolvedById).toBe(organizerId);
    expect(depois[0]!.resolutionNote).toBe('Pago em dinheiro');
  });

  it('o item OPCIONAL não segura a vaga — recebê-lo não confirma nada', async () => {
    const items = await itemsOf(registrationId);

    const result = await resolveConfirmationItem({
      tenantId,
      registrationId,
      itemId: items[1]!.id,
      status: 'RECEIVED',
      actorId: organizerId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.autoConfirmed).toBe(false);
    expect(result.summary).toBe('2 de 3 itens');
    expect(await statusOf(registrationId)).toBe('PENDING:-');
  });

  it('o ÚLTIMO obrigatório confirma a vaga pela via de sempre — autor, trilha e recibo', async () => {
    const items = await itemsOf(registrationId);

    const result = await resolveConfirmationItem({
      tenantId,
      registrationId,
      itemId: items[2]!.id,
      status: 'RECEIVED',
      actorId: organizerId,
      ipAddress: '203.0.113.20',
      userAgent: 'teste-f37',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.autoConfirmed).toBe(true);
    expect(result.summary).toBe('3 de 3 itens');
    expect(result.missingMessage).toBeNull();

    expect(await statusOf(registrationId)).toBe(`CONFIRMED:${organizerId}`);

    /** O recibo do participante saiu UMA vez, pela mesma chave de sempre. */
    const recibos = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findMany({
        where: { dedupeKey: `registration-confirmed-${registrationId}` },
        select: { template: true },
      }),
    );

    expect(recibos).toEqual([{ template: 'REGISTRATION_CONFIRMED' }]);

    /** A trilha guarda cada item E a confirmação: as duas pontas do mesmo fato. */
    const trilhaItens = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'RegistrationConfirmationItem', action: 'UPDATE' },
        select: { entityId: true, userId: true, changes: true },
      }),
    );

    const meusItens = new Set(items.map((item) => item.id));
    const daInscricao = trilhaItens.filter((row) => meusItens.has(row.entityId));

    expect(daInscricao).toHaveLength(3);
    expect(daInscricao.every((row) => row.userId === organizerId)).toBe(true);
    expect(JSON.stringify(daInscricao.at(-1)!.changes)).toContain('RECEIVED');

    const trilhaInscricao = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'Registration', entityId: registrationId },
        select: { changes: true },
      }),
    );

    expect(trilhaInscricao).toHaveLength(1);
    expect(JSON.stringify(trilhaInscricao[0]!.changes)).toContain('CONFIRMED');
  });

  it('item já resolvido é recusado — dois cliques no balcão produzem UM efeito', async () => {
    const items = await itemsOf(registrationId);

    const primeiro = await resolveConfirmationItem({
      tenantId,
      registrationId,
      itemId: items[0]!.id,
      status: 'WAIVED',
      actorId: organizerId,
    });

    expect(primeiro.ok).toBe(false);
    if (!primeiro.ok) expect(primeiro.code).toBe('ALREADY_RESOLVED');
  });

  it('DOIS cliques SIMULTÂNEOS no mesmo item: um só vence', async () => {
    const activityId = await createActivity({
      slug: `corrida-item-${RUN}`,
      requirements: [{ kind: 'ITEM', label: 'Um livro', note: null }],
    });

    const pessoa = await createUser('Pessoa da corrida de item');
    const inscricao = await register(`corrida-item-${RUN}`, pessoa);
    const items = await itemsOf(inscricao.registrationId);

    const [primeira, segunda] = await Promise.all([
      resolveConfirmationItem({
        tenantId,
        registrationId: inscricao.registrationId,
        itemId: items[0]!.id,
        status: 'RECEIVED',
        actorId: organizerId,
      }),
      resolveConfirmationItem({
        tenantId,
        registrationId: inscricao.registrationId,
        itemId: items[0]!.id,
        status: 'WAIVED',
        actorId: organizerId,
      }),
    ]);

    const vencedoras = [primeira, segunda].filter((outcome) => outcome.ok);
    expect(vencedoras).toHaveLength(1);

    /** E a vaga confirmou UMA vez, apesar das duas tentativas. */
    expect(await statusOf(inscricao.registrationId)).toBe(`CONFIRMED:${organizerId}`);

    const recibos = await withTenant(tenantId, (tx) =>
      tx.emailMessage.count({
        where: { dedupeKey: `registration-confirmed-${inscricao.registrationId}` },
      }),
    );

    expect(recibos).toBe(1);
    expect(activityId).toBeTruthy();

    const depois = await itemsOf(inscricao.registrationId);
    expect(['RECEIVED', 'WAIVED']).toContain(depois[0]!.status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('dispensar também resolve', () => {
  it('WAIVED fecha o checklist e confirma a vaga, com o motivo gravado', async () => {
    await createActivity({
      slug: `dispensa-${RUN}`,
      requirements: [{ kind: 'DONATION', label: '1 kg de alimento', note: null }],
    });

    const pessoa = await createUser('Pessoa da dispensa');
    const inscricao = await register(`dispensa-${RUN}`, pessoa);
    const items = await itemsOf(inscricao.registrationId);

    const result = await resolveConfirmationItem({
      tenantId,
      registrationId: inscricao.registrationId,
      itemId: items[0]!.id,
      status: 'WAIVED',
      actorId: organizerId,
      note: 'A organização abriu mão da doação neste dia',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.autoConfirmed).toBe(true);

    const depois = await itemsOf(inscricao.registrationId);
    expect(depois[0]!.status).toBe('WAIVED');
    expect(depois[0]!.resolutionNote).toContain('abriu mão');
    expect(await statusOf(inscricao.registrationId)).toBe(`CONFIRMED:${organizerId}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('limites do item', () => {
  it('item de OUTRA inscrição não é alcançado', async () => {
    const items = await withTenant(tenantId, (tx) =>
      tx.registrationConfirmationItem.findFirstOrThrow({
        where: { registration: { activity: { slug: `snapshot-${RUN}` } } },
        select: { id: true, registrationId: true },
      }),
    );

    const outra = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { activity: { slug: `dispensa-${RUN}` } },
        select: { id: true },
      }),
    );

    const result = await resolveConfirmationItem({
      tenantId,
      registrationId: outra.id,
      itemId: items.id,
      status: 'RECEIVED',
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('a instituição VIZINHA não marca o item da outra — a RLS responde "não existe"', async () => {
    const items = await withTenant(tenantId, (tx) =>
      tx.registrationConfirmationItem.findFirstOrThrow({
        where: { registration: { activity: { slug: `dispensa-${RUN}` } } },
        select: { id: true, registrationId: true },
      }),
    );

    const result = await resolveConfirmationItem({
      tenantId: otherTenantId,
      registrationId: items.registrationId,
      itemId: items.id,
      status: 'RECEIVED',
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('a inscrição sem checklist não tem item para marcar', async () => {
    // Atividade REQUIRED sem exigência: confirmação válida pelo LOCAL, sem checklist.
    await createActivity({
      slug: `so-local-${RUN}`,
      requirements: [],
    });

    const pessoa = await createUser('Pessoa só do local');
    const inscricao = await register(`so-local-${RUN}`, pessoa);

    expect(await itemsOf(inscricao.registrationId)).toEqual([]);

    const result = await resolveConfirmationItem({
      tenantId,
      registrationId: inscricao.registrationId,
      itemId: randomUUID(),
      status: 'RECEIVED',
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');

    /** E a vaga continua RETIDA: sem checklist, quem confirma é a equipe. */
    expect(await statusOf(inscricao.registrationId)).toBe('PENDING:-');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('quem é promovido da lista de espera também recebe o checklist', () => {
  /**
   * TODO caminho que cria inscrição numa atividade que cobra algo tem de criar o
   * checklist — senão a única pessoa do evento sem checklist seria a que foi chamada por
   * último, e o balcão não teria onde marcar o que ela trouxe (armadilha 65).
   */
  it('a promoção cria o checklist da atividade, com a vaga já confirmada', async () => {
    await createActivity({
      slug: `promocao-${RUN}`,
      capacity: 1,
      waitlistEnabled: true,
      requirements: [
        { kind: 'PAYMENT', label: 'Taxa de R$ 30', note: null },
        { kind: 'DONATION', label: '2 kg de alimento', note: null, required: false },
      ],
    });

    const primeira = await createUser('Primeira da promoção');
    const segunda = await createUser('Segunda da promoção');

    const inscricaoPrimeira = await register(`promocao-${RUN}`, primeira);
    expect(inscricaoPrimeira.status).toBe('PENDING');

    const inscricaoSegunda = await register(`promocao-${RUN}`, segunda);
    expect(inscricaoSegunda.status).toBe('WAITLISTED');

    /** Quem esperava não tem checklist: não há vaga retida para confirmar. */
    expect(await itemsOf(inscricaoSegunda.registrationId)).toEqual([]);

    /** O prazo da primeira vence e a varredura libera a vaga para a segunda. */
    await withTenant(tenantId, (tx) =>
      tx.registration.update({
        where: { id: inscricaoPrimeira.registrationId },
        data: { confirmationDueAt: new Date(Date.now() - 60_000) },
      }),
    );

    await runConfirmationExpirySweep();

    expect(await statusOf(inscricaoSegunda.registrationId)).toBe('CONFIRMED:-');

    const items = await itemsOf(inscricaoSegunda.registrationId);

    expect(items.map((item) => item.label)).toEqual(['Taxa de R$ 30', '2 kg de alimento']);
    expect(items.map((item) => item.required)).toEqual([true, false]);
    expect(items.every((item) => item.status === 'PENDING')).toBe(true);

    /** E o balcão consegue marcar o que ela trouxe, sem mexer na vaga já confirmada. */
    const marcado = await resolveConfirmationItem({
      tenantId,
      registrationId: inscricaoSegunda.registrationId,
      itemId: items[0]!.id,
      status: 'RECEIVED',
      actorId: organizerId,
    });

    expect(marcado.ok, marcado.ok ? 'ok' : marcado.message).toBe(true);
    if (!marcado.ok) return;

    /** A vaga já estava confirmada: a marcação registra o item e não reconfirma nada. */
    expect(marcado.autoConfirmed).toBe(false);
    expect(await statusOf(inscricaoSegunda.registrationId)).toBe('CONFIRMED:-');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a fila da equipe devolve o checklist', () => {
  it('cada inscrição chega com os itens e o resumo, e a vizinha não vê nada', async () => {
    const result = await listConfirmationQueue({
      tenantId,
      eventId,
      activityId: null,
      search: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = [...result.queue.pending, ...result.queue.confirmed];
    expect(rows.length).toBeGreaterThan(0);

    const comChecklist = rows.filter((row) => row.items.length > 0);
    expect(comChecklist.length).toBeGreaterThan(0);

    for (const row of comChecklist) {
      /** A ordem é a do snapshot, e o id é o que a ação usa para marcar. */
      expect(row.items.map((item) => item.position)).toEqual(
        [...row.items.map((item) => item.position)].sort((a, b) => a - b),
      );
      expect(row.items.every((item) => item.id.length > 0)).toBe(true);
      expect(row.itemsSummary).toMatch(/\d+ de \d+ itens/);
    }

    /** O checklist é DESTA inscrição: nenhum item aparece em duas linhas. */
    const ids = comChecklist.flatMap((row) => row.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);

    const vizinha = await listConfirmationQueue({
      tenantId: otherTenantId,
      eventId,
      activityId: null,
      search: null,
    });

    expect(vizinha.ok).toBe(false);
  });
});
