/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Inscrição no evento e atividades abertas (revisão da FASE 3)
 *
 *  Contra o PostgreSQL real, prova o que o domínio puro não alcança:
 *    • a inscrição no EVENTO reserva vaga na lotação do evento e MATERIALIZA a
 *      inscrição nas atividades abertas (`origin = EVENT_AUTO`);
 *    • atividade com inscrição própria NÃO recebe ninguém automaticamente;
 *    • quem já tinha inscrição na atividade não ganha uma segunda linha;
 *    • cancelar a inscrição do evento leva junto o que ela criou — e só isso;
 *    • atividade aberta publicada DEPOIS alcança quem já estava no evento;
 *    • excluir atividade com inscritos é recusado; sem ninguém, é exclusão lógica.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { deleteActivity, getAdminEvent, saveActivity } from '../../src/lib/admin/catalog-service';
import {
  cancelRegistration,
  findMyEventRegistration,
  listMyRegistrations,
  registerForActivity,
  registerForEvent,
} from '../../src/lib/events/registration-service';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-geral-${RUN}`;

let tenantId: string;
let eventId: string;
/** Evento pequeno, só para provar a lotação do EVENTO (e não a da atividade). */
let smallEventId: string;
let smallEventSlug: string;
let openActivityId: string;
let openActivitySlug: string;
let individualActivityId: string;
let individualActivitySlug: string;

/** Cria um usuário da plataforma (sem vínculo: a inscrição pública o cria). */
async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: label, email: `f3revisao.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

function activitySlugFor(label: string): string {
  return `${label}-${RUN}`;
}

/** Cria uma atividade do evento com o comportamento de inscrição desejado. */
async function createActivity(input: {
  label: string;
  requiresRegistration: boolean;
  capacity?: number | null;
}): Promise<string> {
  const result = await saveActivity({
    tenantId,
    actorId: organizerId,
    eventId,
    slug: activitySlugFor(input.label),
    title: `Atividade ${input.label} ${RUN}`,
    type: input.requiresRegistration ? 'MINI_COURSE' : 'LECTURE',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(31),
    endsAt: new Date(daysFromNow(31).getTime() + 3_600_000),
    workloadMinutes: 60,
    capacity: input.capacity ?? null,
    waitlistEnabled: false,
    requiresRegistration: input.requiresRegistration,
  });

  if (!result.ok) throw new Error(`Falha ao criar atividade: ${result.message}`);
  return result.activityId;
}

let organizerId: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f3-revisao-${RUN}`,
      name: `Instituição Revisão F3 ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  organizerId = await createUser('organizadora');

  eventId = randomUUID();
  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: `Congresso Geral ${RUN}`,
        summary: 'Evento da revisão da FASE 3.',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt: daysFromNow(30),
        endsAt: daysFromNow(33),
        timezone: 'America/Bahia',
        /**
         * SEM limite: o evento principal é o cenário de vários testes, e uma
         * capacidade pequena faria um teste consumir a vaga do seguinte (o sintoma
         * era "a lotação total do evento foi atingida" num teste que não falava de
         * lotação). O limite tem cenário PRÓPRIO, abaixo.
         */
        capacity: null,
        confirmedCount: 0,
        registrationOpensAt: daysFromNow(-1),
        registrationClosesAt: daysFromNow(32),
      },
    }),
  );

  smallEventId = randomUUID();
  smallEventSlug = `evento-pequeno-${RUN}`;
  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: smallEventId,
        tenantId,
        slug: smallEventSlug,
        title: `Evento pequeno ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt: daysFromNow(30),
        endsAt: daysFromNow(31),
        timezone: 'America/Bahia',
        capacity: 2,
        confirmedCount: 0,
        registrationOpensAt: daysFromNow(-1),
        registrationClosesAt: daysFromNow(29),
      },
    }),
  );

  openActivityId = await createActivity({ label: 'aberta', requiresRegistration: false });
  openActivitySlug = activitySlugFor('aberta');
  individualActivityId = await createActivity({ label: 'minicurso', requiresRegistration: true, capacity: 10 });
  individualActivitySlug = activitySlugFor('minicurso');
});

afterAll(async () => {
  await adminPrisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
});

describe('inscrição no evento — materializa as atividades abertas', () => {
  it('inscreve no evento E nas atividades abertas, deixando as de inscrição própria vazias', async () => {
    const userId = await createUser('participante-a');

    const outcome = await registerForEvent({
      tenantId,
      eventSlug: EVENT_SLUG,
      userId,
      consentData: true,
    });

    expect(outcome.ok, outcome.ok ? 'ok' : outcome.message).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.enrolledActivities).toBe(1);
    expect(outcome.titles).toHaveLength(1);

    const rows = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { userId, eventId },
        select: { activityId: true, status: true, origin: true },
      }),
    );

    // Duas linhas: a do evento (activityId nulo) e a automática na atividade aberta.
    expect(rows).toHaveLength(2);

    const eventRow = rows.find((row) => row.activityId === null);
    expect(eventRow?.origin).toBe('INDIVIDUAL');
    expect(eventRow?.status).toBe('CONFIRMED');

    const automatic = rows.find((row) => row.activityId === openActivityId);
    expect(automatic?.origin).toBe('EVENT_AUTO');
    expect(automatic?.status).toBe('CONFIRMED');

    // Nada em atividade com inscrição própria: essa é escolha da pessoa.
    expect(rows.some((row) => row.activityId === individualActivityId)).toBe(false);

    // Os contadores acompanham: evento e atividade aberta.
    const [event, activity] = await withTenant(tenantId, (tx) =>
      Promise.all([
        tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { confirmedCount: true } }),
        tx.activity.findUniqueOrThrow({
          where: { id: openActivityId },
          select: { confirmedCount: true },
        }),
      ]),
    );

    expect(event.confirmedCount).toBe(1);
    expect(activity.confirmedCount).toBe(1);

    // A lista pessoal mostra as duas, com os marcadores que a tela usa.
    const mine = await listMyRegistrations(tenantId, userId);
    expect(mine).toHaveLength(2);
    expect(mine.some((row) => row.isEventRegistration)).toBe(true);
    expect(mine.some((row) => row.isAutomatic)).toBe(true);

    const found = await findMyEventRegistration(tenantId, userId, eventId);
    expect(found?.status).toBe('CONFIRMED');
  }, 60_000);

  it('RECUSA a segunda inscrição no mesmo evento', async () => {
    const userId = await createUser('participante-b');

    const first = await registerForEvent({ tenantId, eventSlug: EVENT_SLUG, userId, consentData: true });
    expect(first.ok).toBe(true);

    const second = await registerForEvent({ tenantId, eventSlug: EVENT_SLUG, userId, consentData: true });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('DUPLICATE');
  }, 60_000);

  it('quem JÁ tinha inscrição na atividade aberta não ganha uma segunda linha', async () => {
    const userId = await createUser('participante-c');

    /**
     * A ordem é a do mundo real: a pessoa escolheu a atividade quando ela ainda
     * exigia inscrição... e depois a instituição a tornou aberta. A linha existente
     * é preservada como INDIVIDUAL — a escolha dela não é reescrita.
     */
    await withTenant(tenantId, (tx) =>
      tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: openActivityId,
          userId,
          origin: 'INDIVIDUAL',
          status: 'CONFIRMED',
        },
      }),
    );

    const outcome = await registerForEvent({ tenantId, eventSlug: EVENT_SLUG, userId, consentData: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Nenhuma linha automaticamente criada: já havia inscrição viva ali.
    expect(outcome.enrolledActivities).toBe(0);

    const rows = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { userId, eventId, activityId: openActivityId },
        select: { origin: true },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin).toBe('INDIVIDUAL');
  }, 60_000);

  it('RECUSA inscrição individual em atividade aberta, apontando o caminho', async () => {
    const userId = await createUser('participante-d');

    const outcome = await registerForActivity({
      tenantId,
      eventSlug: EVENT_SLUG,
      activitySlug: openActivitySlug,
      userId,
      consentData: true,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('ACTIVITY_OPEN');
    expect(outcome.message).toMatch(/inscreva-se no evento/i);

    // Atividade com inscrição própria continua funcionando como antes.
    const individual = await registerForActivity({
      tenantId,
      eventSlug: EVENT_SLUG,
      activitySlug: individualActivitySlug,
      userId,
      consentData: true,
    });
    expect(individual.ok, individual.ok ? 'ok' : individual.message).toBe(true);
  }, 60_000);

  it('o evento respeita a própria lotação', async () => {
    // Evento com 2 vagas: a terceira pessoa é recusada mesmo sem atividade envolvida.
    const first = await createUser('lotacao-0');
    const second = await createUser('lotacao-1');
    const third = await createUser('lotacao-2');

    const outcomes = [];
    for (const userId of [first, second, third]) {
      outcomes.push(await registerForEvent({ tenantId, eventSlug: smallEventSlug, userId, consentData: true }));
    }

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(2);

    const refused = outcomes.find((outcome) => !outcome.ok);
    expect(refused).toBeTruthy();
    if (refused && !refused.ok) expect(refused.code).toBe('FULL');
  }, 90_000);
});

describe('cancelamento da inscrição no evento', () => {
  it('cancela o que o evento criou e PRESERVA as escolhas individuais', async () => {
    const userId = await createUser('cancelamento');

    const eventRegistration = await registerForEvent({
      tenantId,
      eventSlug: EVENT_SLUG,
      userId,
      consentData: true,
    });
    expect(eventRegistration.ok).toBe(true);
    if (!eventRegistration.ok) return;

    // A pessoa também escolheu um minicurso por conta própria.
    const individual = await registerForActivity({
      tenantId,
      eventSlug: EVENT_SLUG,
      activitySlug: individualActivitySlug,
      userId,
      consentData: true,
    });
    expect(individual.ok).toBe(true);

    const cancelled = await cancelRegistration({
      tenantId,
      registrationId: eventRegistration.registrationId,
      userId,
      reason: 'Não poderei ir',
    });
    expect(cancelled.ok, cancelled.ok ? 'ok' : cancelled.message).toBe(true);

    const rows = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { userId, eventId },
        select: { activityId: true, status: true, origin: true },
      }),
    );

    const eventRow = rows.find((row) => row.activityId === null);
    expect(eventRow?.status).toBe('CANCELED');

    const automatic = rows.find((row) => row.activityId === openActivityId);
    expect(automatic?.status).toBe('CANCELED');

    // O minicurso escolhido por ela continua confirmado.
    const chosen = rows.find((row) => row.activityId === individualActivityId);
    expect(chosen?.status).toBe('CONFIRMED');
  }, 90_000);
});

describe('atividade aberta publicada depois e exclusão de atividade', () => {
  it('sincroniza quem já estava no evento ao criar uma atividade aberta', async () => {
    const userId = await createUser('sincronia');

    const eventRegistration = await registerForEvent({
      tenantId,
      eventSlug: EVENT_SLUG,
      userId,
      consentData: true,
    });
    expect(eventRegistration.ok).toBe(true);
    if (!eventRegistration.ok) return;

    // Atividade aberta criada DEPOIS da inscrição: precisa alcançar quem já entrou.
    const lateActivityId = await createActivity({ label: 'tardia', requiresRegistration: false });

    const rows = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { activityId: lateActivityId },
        select: { userId: true, origin: true },
      }),
    );

    expect(rows.some((row) => row.userId === userId)).toBe(true);
    expect(rows.every((row) => row.origin === 'EVENT_AUTO')).toBe(true);
  }, 90_000);

  it('RECUSA excluir atividade com inscritos, e exclui a que não tem ninguém', async () => {
    const comInscritos = await deleteActivity({
      tenantId,
      actorId: organizerId,
      eventId,
      activityId: openActivityId,
    });

    expect(comInscritos.ok).toBe(false);
    if (comInscritos.ok) return;
    expect(comInscritos.message).toMatch(/cancele/i);

    // A atividade continua na programação.
    const detail = await getAdminEvent(tenantId, eventId);
    expect(detail?.activities.some((activity) => activity.id === openActivityId)).toBe(true);

    // Uma atividade vazia sai (exclusão lógica) e some da lista do organizador.
    const vaziaId = await createActivity({ label: 'vazia', requiresRegistration: true });
    const excluida = await deleteActivity({
      tenantId,
      actorId: organizerId,
      eventId,
      activityId: vaziaId,
    });

    expect(excluida.ok, excluida.ok ? 'ok' : excluida.message).toBe(true);

    const after = await getAdminEvent(tenantId, eventId);
    expect(after?.activities.some((activity) => activity.id === vaziaId)).toBe(false);

    // E o dado continua no banco, apenas marcado — exclusão lógica.
    const row = await withTenant(tenantId, (tx) =>
      tx.activity.findUniqueOrThrow({ where: { id: vaziaId }, select: { deletedAt: true } }),
    );
    expect(row.deletedAt).not.toBeNull();
  }, 90_000);

  it('RECUSA reduzir a lotação abaixo das inscrições já ativas', async () => {
    // Uma pessoa inscrita no minicurso: agora reduzir a lotação para 0 é inválido.
    const userId = await createUser('lotacao-minicurso');
    const registered = await registerForActivity({
      tenantId,
      eventSlug: EVENT_SLUG,
      activitySlug: individualActivitySlug,
      userId,
      consentData: true,
    });
    expect(registered.ok, registered.ok ? 'ok' : registered.message).toBe(true);

    const result = await saveActivity({
      tenantId,
      actorId: organizerId,
      eventId,
      activityId: individualActivityId,
      slug: activitySlugFor('minicurso'),
      title: `Atividade minicurso ${RUN}`,
      type: 'MINI_COURSE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: daysFromNow(31),
      endsAt: new Date(daysFromNow(31).getTime() + 3_600_000),
      workloadMinutes: 60,
      capacity: 0,
      waitlistEnabled: false,
      requiresRegistration: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/abaixo/i);
  }, 60_000);
});
