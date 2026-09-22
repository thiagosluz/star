import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveActivity } from '../../src/lib/admin/catalog-service';
import { registerForActivity } from '../../src/lib/events/registration-service';
import {
  confirmRegistration,
  listConfirmationQueue,
  runConfirmationExpirySweep,
  runConfirmationReminderScan,
} from '../../src/lib/events/confirmation-service';
import { EXPIRY_CANCEL_REASON } from '../../src/domain/events/confirmation-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let organizerId: string;

const now = new Date();
const eventStartsAt = new Date(now.getTime() + 30 * 86_400_000);

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Confirmação de vaga com prazo (FASE 34) — integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a inscrição numa atividade que exige confirmação nasce `PENDING` e **RETÉM a
 *    vaga** — é a única razão de o prazo existir (se não retivesse, liberar não
 *    devolveria nada);
 *  • o aviso da inscrição sai nos DOIS canais (caixa de entrada + outbox) com a
 *    MESMA `dedupeKey`, e a confirmação da equipe também avisa;
 *  • a transição é ATÔMICA: duas confirmações concorrentes produzem um efeito só, e
 *    confirmar depois do prazo é recusado com o motivo certo;
 *  • a VARREDURA libera a vaga vencida, devolve o lugar no evento, promove o primeiro
 *    da lista de espera e é IDEMPOTENTE (duas passadas não liberam duas vagas);
 *  • o LEMBRETE sai uma vez só, e nunca depois do vencimento;
 *  • a RLS responde "não existe" para a instituição vizinha, e a fila da equipe não
 *    mostra o que é da outra;
 *  • desligar a política com gente esperando é RECUSADO (as pendentes ficariam sem
 *    saída), e atividade ABERTA não aceita confirmação individual.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f34.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

/** Cria uma atividade com a política escolhida — pelo serviço real, como na tela. */
async function createActivity(input: {
  slug: string;
  title: string;
  capacity: number | null;
  waitlistEnabled?: boolean;
  policy?: 'AUTO' | 'REQUIRED';
  windowDays?: number | null;
  requirements?: unknown;
  place?: string | null;
}): Promise<string> {
  const result = await saveActivity({
    tenantId,
    actorId: organizerId,
    eventId,
    slug: input.slug,
    title: input.title,
    type: 'WORKSHOP',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: eventStartsAt,
    endsAt: new Date(eventStartsAt.getTime() + 3 * 3_600_000),
    workloadMinutes: 180,
    capacity: input.capacity,
    waitlistEnabled: input.waitlistEnabled ?? false,
    requiresRegistration: true,
    confirmationPolicy: input.policy ?? 'REQUIRED',
    confirmationWindowDays: input.windowDays ?? 3,
    confirmationRequirements: input.requirements ?? [
      { kind: 'DONATION', label: '1 kg de alimento', note: null },
    ],
    confirmationPlace: input.place ?? 'Secretaria do bloco B',
  });

  if (!result.ok) throw new Error(`Falha ao criar a atividade: ${result.message}`);

  return result.activityId;
}

async function counters(activityId: string): Promise<{ activity: number; event: number }> {
  return withTenant(tenantId, async (tx) => {
    const activity = await tx.activity.findFirstOrThrow({
      where: { id: activityId },
      select: { confirmedCount: true, eventId: true },
    });

    const event = await tx.event.findFirstOrThrow({
      where: { id: activity.eventId },
      select: { confirmedCount: true },
    });

    return { activity: activity.confirmedCount, event: event.confirmedCount };
  });
}

async function outbox(dedupeKey: string): Promise<{ template: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx.emailMessage.findMany({ where: { dedupeKey }, select: { template: true } }),
  );
}

async function inbox(dedupeKey: string): Promise<{ subject: string; sentById: string | null }[]> {
  return withTenant(tenantId, (tx) =>
    tx.participantMessage.findMany({
      where: { dedupeKey },
      select: { subject: true, sentById: true },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f34-${RUN}`,
        name: `Instituição da Confirmação ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f34-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  organizerId = await createUser('Organizadora F34');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-confirmacao-${RUN}`,
        title: 'Congresso com vagas confirmáveis',
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
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f34.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('inscrição em atividade que exige confirmação', () => {
  it('nasce PENDING, RETÉM a vaga e avisa nos dois canais', async () => {
    const activityId = await createActivity({
      slug: `retem-${RUN}`,
      title: 'Oficina com doação',
      capacity: 1,
      /** Com lista de espera: o cenário seguinte prova que a vaga retida ocupa o lugar. */
      waitlistEnabled: true,
    });

    const pessoa = await createUser('Pessoa que retém');

    const result = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `retem-${RUN}`,
      userId: pessoa,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.status).toBe('PENDING');
    expect(result.confirmationDueAt).toBeInstanceOf(Date);

    /**
     * A VAGA ESTÁ RETIDA: o contador da atividade e o do evento contam a inscrição
     * pendente. É isso que faz o prazo ter consequência.
     */
    const after = await counters(activityId);
    expect(after.activity).toBe(1);
    expect(after.event).toBe(1);

    /** O aviso saiu nos dois canais, com a MESMA chave (a regra da FASE 32). */
    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { activityId, userId: pessoa },
        select: { id: true },
      }),
    );

    const key = `registration-pending-${registration.id}`;
    expect(await outbox(key)).toEqual([{ template: 'REGISTRATION_PENDING' }]);

    const messages = await inbox(key);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toContain('Confirme sua vaga');
    /** Aviso do SISTEMA não tem autor humano — atribuir a alguém seria inventar autoria. */
    expect(messages[0]!.sentById).toBeNull();
  });

  it('com a vaga retida, a segunda pessoa vai para a lista de espera', async () => {
    const segunda = await createUser('Segunda pessoa');

    const result = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `retem-${RUN}`,
      userId: segunda,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.status).toBe('WAITLISTED');
    expect(result.confirmationDueAt).toBeNull();
  });

  it('o prazo é o fim do dia local, N dias depois da inscrição', async () => {
    const registro = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { activity: { slug: `retem-${RUN}` }, status: 'PENDING' },
        select: { confirmationDueAt: true, createdAt: true },
      }),
    );

    const due = registro.confirmationDueAt!;
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      dateStyle: 'short',
    }).format(due);

    const dayAfter = new Date(registro.createdAt.getTime() + 3 * 86_400_000);
    const expectedDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      dateStyle: 'short',
    }).format(dayAfter);

    expect(local).toBe(expectedDay);
    /** 23:59 no fuso do evento: o prazo é o DIA inteiro, não 24 horas corridas. */
    expect(
      new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, timeStyle: 'short' }).format(due),
    ).toBe('23:59');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a equipe confirma', () => {
  it('confirma a vaga pendente, registra quem confirmou e avisa a pessoa', async () => {
    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { activity: { slug: `retem-${RUN}` }, status: 'PENDING' },
        select: { id: true, userId: true },
      }),
    );

    const result = await confirmRegistration({
      tenantId,
      registrationId: registration.id,
      actorId: organizerId,
      ipAddress: '203.0.113.10',
      userAgent: 'teste-f34',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.emailQueued).toBe(true);

    const row = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { id: registration.id },
        select: { status: true, confirmedAt: true, confirmedById: true },
      }),
    );

    expect(row.status).toBe('CONFIRMED');
    expect(row.confirmedAt).toBeInstanceOf(Date);
    expect(row.confirmedById).toBe(organizerId);

    /** O recibo saiu — e o aviso da pendência continua sendo UM só. */
    expect(await outbox(`registration-confirmed-${registration.id}`)).toEqual([
      { template: 'REGISTRATION_CONFIRMED' },
    ]);

    /** A trilha guarda QUEM confirmou: é a pergunta que a instituição faz depois. */
    const audit = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { entityType: 'Registration', entityId: registration.id },
        select: { action: true, userId: true, changes: true },
      }),
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]!.userId).toBe(organizerId);
    expect(JSON.stringify(audit[0]!.changes)).toContain('CONFIRMED');
  });

  it('confirmar de novo é recusado dizendo que já está confirmada', async () => {
    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { activity: { slug: `retem-${RUN}` }, status: 'CONFIRMED' },
        select: { id: true },
      }),
    );

    const result = await confirmRegistration({
      tenantId,
      registrationId: registration.id,
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('ALREADY_CONFIRMED');
  });

  it('DUAS confirmações simultâneas produzem UM efeito (o UPDATE condicional decide)', async () => {
    const activityId = await createActivity({
      slug: `corrida-${RUN}`,
      title: 'Oficina da corrida',
      capacity: 5,
    });

    const pessoa = await createUser('Pessoa da corrida');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `corrida-${RUN}`,
      userId: pessoa,
    });

    expect(inscricao.ok && inscricao.status === 'PENDING').toBe(true);
    if (!inscricao.ok) return;

    const [primeira, segunda] = await Promise.all([
      confirmRegistration({ tenantId, registrationId: inscricao.registrationId, actorId: organizerId }),
      confirmRegistration({ tenantId, registrationId: inscricao.registrationId, actorId: organizerId }),
    ]);

    const sucessos = [primeira, segunda].filter((outcome) => outcome.ok);
    expect(sucessos).toHaveLength(1);

    /** Um recibo só, apesar das duas tentativas. */
    expect(
      await outbox(`registration-confirmed-${inscricao.registrationId}`),
    ).toHaveLength(1);

    /** A vaga não foi consumida duas vezes. */
    expect((await counters(activityId)).activity).toBe(1);
  });

  it('atividade automática não tem o que confirmar', async () => {
    const activityId = await createActivity({
      slug: `automatica-${RUN}`,
      title: 'Oficina automática',
      capacity: 5,
      policy: 'AUTO',
    });

    const pessoa = await createUser('Pessoa da automática');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `automatica-${RUN}`,
      userId: pessoa,
    });

    expect(inscricao.ok && inscricao.status === 'CONFIRMED').toBe(true);
    if (!inscricao.ok) return;

    expect(inscricao.confirmationDueAt).toBeNull();
    expect(activityId).toBeTruthy();

    const result = await confirmRegistration({
      tenantId,
      registrationId: inscricao.registrationId,
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_REQUIRED');
  });

  it('prazo vencido não se confirma — o aviso é do relógio, não da varredura', async () => {
    const activityId = await createActivity({
      slug: `vencido-${RUN}`,
      title: 'Oficina de prazo vencido',
      capacity: 5,
    });

    const pessoa = await createUser('Pessoa do prazo vencido');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `vencido-${RUN}`,
      userId: pessoa,
    });

    if (!inscricao.ok) throw new Error(inscricao.message);

    /** O prazo passa — sem que a varredura tenha rodado (é o estado real: ela roda de hora em hora). */
    await withTenant(tenantId, (tx) =>
      tx.registration.update({
        where: { id: inscricao.registrationId },
        data: { confirmationDueAt: new Date(Date.now() - 60_000) },
      }),
    );

    const result = await confirmRegistration({
      tenantId,
      registrationId: inscricao.registrationId,
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EXPIRED');

    /** E nada mudou no banco: a vaga continua retida com quem venceu. */
    const row = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { id: inscricao.registrationId },
        select: { status: true },
      }),
    );

    expect(row.status).toBe('PENDING');
    expect((await counters(activityId)).activity).toBe(1);
  });

  it('a instituição vizinha não confirma o que é da outra', async () => {
    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { activity: { slug: `vencido-${RUN}` } },
        select: { id: true },
      }),
    );

    const result = await confirmRegistration({
      tenantId: otherTenantId,
      registrationId: registration.id,
      actorId: organizerId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a varredura libera o que venceu', () => {
  let activityId: string;
  let primeiraPessoa: string;
  let segundaPessoa: string;

  beforeAll(async () => {
    activityId = await createActivity({
      slug: `liberacao-${RUN}`,
      title: 'Oficina da liberação',
      capacity: 1,
      waitlistEnabled: true,
    });

    primeiraPessoa = await createUser('Primeira da liberação');
    segundaPessoa = await createUser('Segunda da liberação');

    const primeira = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `liberacao-${RUN}`,
      userId: primeiraPessoa,
    });

    if (!primeira.ok || primeira.status !== 'PENDING') {
      throw new Error('a primeira inscrição deveria nascer PENDING');
    }

    const segunda = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `liberacao-${RUN}`,
      userId: segundaPessoa,
    });

    if (!segunda.ok || segunda.status !== 'WAITLISTED') {
      throw new Error('a segunda inscrição deveria ir para a lista de espera');
    }

    /** O prazo da primeira vence. */
    await withTenant(tenantId, (tx) =>
      tx.registration.update({
        where: { id: primeira.registrationId },
        data: { confirmationDueAt: new Date(Date.now() - 60_000) },
      }),
    );
  });

  it('libera a vaga, promove o primeiro da espera e avisa OS DOIS', async () => {
    const sweep = await runConfirmationExpirySweep();

    expect(sweep.released).toBeGreaterThanOrEqual(1);
    expect(sweep.promoted).toBeGreaterThanOrEqual(1);

    const rows = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { activityId },
        select: { userId: true, status: true, cancelReason: true },
      }),
    );

    const primeira = rows.find((row) => row.userId === primeiraPessoa)!;
    const segunda = rows.find((row) => row.userId === segundaPessoa)!;

    expect(primeira.status).toBe('CANCELED');
    expect(primeira.cancelReason).toBe(EXPIRY_CANCEL_REASON);
    expect(segunda.status).toBe('CONFIRMED');

    /** A vaga não sumiu: passou para quem esperava. */
    expect((await counters(activityId)).activity).toBe(1);

    const registrations = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { activityId },
        select: { id: true, userId: true },
      }),
    );

    const idPrimeira = registrations.find((row) => row.userId === primeiraPessoa)!.id;
    const idSegunda = registrations.find((row) => row.userId === segundaPessoa)!.id;

    expect(await outbox(`registration-released-${idPrimeira}`)).toEqual([
      { template: 'REGISTRATION_RELEASED' },
    ]);
    expect(await outbox(`waitlist-promoted-${idSegunda}`)).toEqual([
      { template: 'WAITLIST_PROMOTED' },
    ]);

    expect(await inbox(`registration-released-${idPrimeira}`)).toHaveLength(1);
    expect(await inbox(`waitlist-promoted-${idSegunda}`)).toHaveLength(1);
  });

  it('rodar de novo não libera uma segunda vaga (idempotência pela chave do fato)', async () => {
    const antes = await counters(activityId);

    const sweep = await runConfirmationExpirySweep();

    const depois = await counters(activityId);

    expect(sweep.released).toBe(0);
    expect(sweep.promoted).toBe(0);
    expect(depois).toEqual(antes);
  });

  it('o contador do EVENTO fecha a conta: a vaga devolvida foi reocupada', async () => {
    /**
     * O evento conta TODA inscrição confirmada (inclusive de atividade). A liberação
     * devolve o lugar e a promoção precisa retomá-lo — se só um dos lados mexesse no
     * contador, o evento passaria a mentir sobre a própria lotação (defeito real
     * encontrado nesta fase).
     */
    const total = await withTenant(tenantId, (tx) =>
      tx.registration.count({
        where: { eventId, deletedAt: null, status: { in: ['PENDING', 'CONFIRMED', 'ATTENDED'] } },
      }),
    );

    expect((await counters(activityId)).event).toBe(total);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o lembrete do prazo', () => {
  it('avisa quem está perto do vencimento — uma vez só', async () => {
    const activityId = await createActivity({
      slug: `lembrete-${RUN}`,
      title: 'Oficina do lembrete',
      capacity: 5,
    });

    const pessoa = await createUser('Pessoa do lembrete');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `lembrete-${RUN}`,
      userId: pessoa,
    });

    if (!inscricao.ok) throw new Error(inscricao.message);

    const key = `registration-due-soon-${inscricao.registrationId}`;

    /** Ainda longe do prazo: nada sai. */
    await withTenant(tenantId, (tx) =>
      tx.registration.update({
        where: { id: inscricao.registrationId },
        data: { confirmationDueAt: new Date(Date.now() + 5 * 86_400_000) },
      }),
    );

    await runConfirmationReminderScan();
    expect(await outbox(key)).toHaveLength(0);

    /** A 20 horas do vencimento: o lembrete sai. */
    await withTenant(tenantId, (tx) =>
      tx.registration.update({
        where: { id: inscricao.registrationId },
        data: { confirmationDueAt: new Date(Date.now() + 20 * 3_600_000) },
      }),
    );

    const primeiro = await runConfirmationReminderScan();
    expect(primeiro.reminded).toBeGreaterThanOrEqual(1);
    expect(await outbox(key)).toEqual([{ template: 'REGISTRATION_DUE_SOON' }]);

    /** A segunda passada não repete: o carimbo é a chave do fato. */
    const segundo = await runConfirmationReminderScan();
    expect(segundo.reminded).toBe(0);
    expect(await outbox(key)).toHaveLength(1);

    expect(activityId).toBeTruthy();
  });

  it('quem confirmou não recebe lembrete', async () => {
    const activityId = await createActivity({
      slug: `lembrete-confirmado-${RUN}`,
      title: 'Oficina do lembrete confirmado',
      capacity: 5,
    });

    const pessoa = await createUser('Pessoa confirmada antes do lembrete');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `lembrete-confirmado-${RUN}`,
      userId: pessoa,
    });

    if (!inscricao.ok) throw new Error(inscricao.message);

    await withTenant(tenantId, (tx) =>
      tx.registration.update({
        where: { id: inscricao.registrationId },
        data: { confirmationDueAt: new Date(Date.now() + 2 * 3_600_000) },
      }),
    );

    const confirmada = await confirmRegistration({
      tenantId,
      registrationId: inscricao.registrationId,
      actorId: organizerId,
    });

    expect(confirmada.ok, confirmada.ok ? 'ok' : confirmada.message).toBe(true);

    await runConfirmationReminderScan();

    expect(await outbox(`registration-due-soon-${inscricao.registrationId}`)).toHaveLength(0);
    expect(activityId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a fila da equipe', () => {
  it('lista as confirmáveis com pendentes e confirmadas, e não vaza a instituição vizinha', async () => {
    const result = await listConfirmationQueue({
      tenantId,
      eventId,
      activityId: null,
      search: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slugs = result.queue.activities.length;
    expect(slugs).toBeGreaterThan(0);

    /** Atividade AUTOMÁTICA não entra na fila: não há o que confirmar nela. */
    expect(result.queue.activities.some((activity) => activity.title.includes('automática'))).toBe(
      false,
    );

    const vazia = await listConfirmationQueue({
      tenantId: otherTenantId,
      eventId,
      activityId: null,
      search: null,
    });

    expect(vazia.ok).toBe(false);
  });

  it('busca pelo nome encontra a pessoa; busca que não casa devolve vazio', async () => {
    const todas = await listConfirmationQueue({ tenantId, eventId, activityId: null, search: null });
    expect(todas.ok).toBe(true);
    if (!todas.ok || !todas.queue.selected) return;

    const alvo = todas.queue.pending[0]?.personName ?? todas.queue.confirmed[0]?.personName;
    if (!alvo) return;

    const encontrada = await listConfirmationQueue({
      tenantId,
      eventId,
      activityId: todas.queue.selected.activityId,
      search: alvo.split(' ')[0]!,
    });

    expect(encontrada.ok).toBe(true);
    if (!encontrada.ok) return;

    const nomes = [...encontrada.queue.pending, ...encontrada.queue.confirmed].map(
      (row) => row.personName,
    );
    expect(nomes).toContain(alvo);

    const semResultado = await listConfirmationQueue({
      tenantId,
      eventId,
      activityId: todas.queue.selected.activityId,
      search: 'ninguém-com-esse-nome',
    });

    expect(semResultado.ok).toBe(true);
    if (!semResultado.ok) return;

    expect(semResultado.queue.pending).toHaveLength(0);
    expect(semResultado.queue.confirmed).toHaveLength(0);
  });

  it('o e-mail sai MASCARADO na lista (a decisão de olhar a pessoa é a ficha)', async () => {
    const result = await listConfirmationQueue({ tenantId, eventId, activityId: null, search: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = [...result.queue.pending, ...result.queue.confirmed];
    expect(rows.length).toBeGreaterThan(0);

    const emails = await withTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { email: { contains: `f34.${RUN}` } },
        select: { name: true, email: true },
      }),
    );

    for (const row of rows) {
      const real = emails.find((person) => person.name === row.personName);
      if (!real) continue;

      /** O local (antes do @) é o que identifica a caixa: é ele que fica ilegível. */
      const local = real.email.split('@')[0]!;
      expect(row.emailMasked).toContain('•');
      expect(row.emailMasked).not.toBe(real.email);
      expect(row.emailMasked).not.toContain(local);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a política no cadastro da atividade', () => {
  it('exigir confirmação sem dizer o que nem onde é RECUSADO', async () => {
    const result = await saveActivity({
      tenantId,
      actorId: organizerId,
      eventId,
      slug: `sem-nada-${RUN}`,
      title: 'Oficina sem instrução',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: eventStartsAt,
      endsAt: new Date(eventStartsAt.getTime() + 3 * 600_000),
      workloadMinutes: 60,
      capacity: 10,
      waitlistEnabled: false,
      requiresRegistration: true,
      confirmationPolicy: 'REQUIRED',
      confirmationWindowDays: 3,
      confirmationRequirements: [],
      confirmationPlace: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('atividade ABERTA não pode exigir confirmação individual', async () => {
    const result = await saveActivity({
      tenantId,
      actorId: organizerId,
      eventId,
      slug: `aberta-${RUN}`,
      title: 'Palestra aberta com confirmação',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: eventStartsAt,
      endsAt: new Date(eventStartsAt.getTime() + 3_600_000),
      workloadMinutes: 60,
      capacity: null,
      waitlistEnabled: false,
      requiresRegistration: false,
      confirmationPolicy: 'REQUIRED',
      confirmationWindowDays: 3,
      confirmationRequirements: [{ kind: 'ITEM', label: 'Um livro' }],
      confirmationPlace: 'Secretaria',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/aberta/i);
  });

  it('desligar a confirmação com gente esperando é RECUSADO', async () => {
    const activityId = await createActivity({
      slug: `desligar-${RUN}`,
      title: 'Oficina que não pode desligar',
      capacity: 5,
    });

    const pessoa = await createUser('Pessoa aguardando');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: `evento-confirmacao-${RUN}`,
      activitySlug: `desligar-${RUN}`,
      userId: pessoa,
    });

    if (!inscricao.ok || inscricao.status !== 'PENDING') {
      throw new Error('a inscrição deveria estar pendente');
    }

    const stored = await withTenant(tenantId, (tx) =>
      tx.activity.findFirstOrThrow({
        where: { id: activityId },
        select: { slug: true, title: true, capacity: true, startsAt: true, endsAt: true },
      }),
    );

    const result = await saveActivity({
      tenantId,
      actorId: organizerId,
      eventId,
      activityId,
      slug: stored.slug,
      title: stored.title,
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: stored.startsAt,
      endsAt: stored.endsAt,
      workloadMinutes: 180,
      capacity: stored.capacity,
      waitlistEnabled: false,
      requiresRegistration: true,
      confirmationPolicy: 'AUTO',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_PENDING_CONFIRMATIONS');
  });
});
