/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Teste de INTEGRAÇÃO — lotação sob concorrência real
 *
 *  Este é o teste mais importante da FASE 3. Ele prova, contra um PostgreSQL
 *  real e com transações simultâneas de verdade, que:
 *
 *    1. NUNCA há superlotação, mesmo com disparos simultâneos;
 *    2. o número de inscrições confirmadas é EXATAMENTE a capacidade;
 *    3. o contador denormalizado bate com a contagem real de linhas;
 *    4. a lista de espera absorve o excedente e preserva a ordem FIFO;
 *    5. cancelar libera vaga e promove o próximo da espera.
 *
 *  Por que isso não pode ser um teste unitário: a garantia vem do
 *  comportamento transacional do banco (serialização de UPDATEs na mesma
 *  linha). Nenhuma simulação em memória reproduz isso.
 *
 *  Requer banco em execução:
 *      docker compose up -d && npm run db:migrate && npm run db:rls
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  cancelRegistration,
  registerForActivity,
} from '../../src/lib/events/registration-service';

// ───────────────────────────────────────────────────────────────────────────────
//  Fixture
// ───────────────────────────────────────────────────────────────────────────────
const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;

/** Cria uma atividade com a capacidade informada. */
async function createActivity(options: {
  slug: string;
  capacity: number | null;
  waitlistEnabled: boolean;
  startsAtOffsetDays?: number;
}): Promise<string> {
  const id = randomUUID();
  const startsAt = new Date(Date.now() + (options.startsAtOffsetDays ?? 30) * 86_400_000);

  await withTenant(tenantId, (tx) =>
    tx.activity.create({
      data: {
        id,
        tenantId,
        eventId,
        slug: options.slug,
        title: `Atividade ${options.slug}`,
        type: 'WORKSHOP',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        capacity: options.capacity,
        waitlistEnabled: options.waitlistEnabled,
        workloadMinutes: 60,
      },
    }),
  );

  return id;
}

/** Cria N usuários distintos. */
async function createUsers(count: number): Promise<string[]> {
  const users = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    name: `Participante ${index}`,
    email: `concurrency.${RUN}.${index}.${randomUUID().slice(0, 6)}@example.test`,
    emailVerified: true,
  }));

  await adminPrisma.user.createMany({ data: users });

  // Vincula todos ao tenant, para que a RLS e o RBAC façam sentido.
  await withTenant(tenantId, (tx) =>
    tx.userTenantProfile.createMany({
      data: users.map((user) => ({
        id: randomUUID(),
        tenantId,
        userId: user.id,
        status: 'ACTIVE' as const,
        joinedAt: new Date(),
      })),
    }),
  );

  return users.map((user) => user.id);
}

/** Lê o estado real direto do banco (contadores + contagem de linhas). */
async function readState(activityId: string) {
  return withTenant(tenantId, async (tx) => {
    const activity = await tx.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: { capacity: true, confirmedCount: true, waitlistCount: true },
    });

    const confirmedRows = await tx.registration.count({
      where: { activityId, status: 'CONFIRMED' },
    });
    const waitlistedRows = await tx.registration.count({
      where: { activityId, status: 'WAITLISTED' },
    });

    return { activity, confirmedRows, waitlistedRows };
  });
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `concurrency-${RUN}`,
      name: `Instituição Concorrência ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
  });

  // Capacidade do EVENTO generosa: queremos isolar o teste na lotação da
  // ATIVIDADE, não no limite do evento.
  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-concorrencia',
        title: 'Evento de Concorrência',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: new Date(Date.now() + 29 * 86_400_000),
        endsAt: new Date(Date.now() + 31 * 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    }),
  );
});

afterAll(async () => {
  // O cascade remove atividades, inscrições e vínculos.
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('lotação sob concorrência', () => {
  it('20 tentativas simultâneas em 5 vagas resultam em EXATAMENTE 5 confirmadas', async () => {
    const CAPACITY = 5;
    const ATTEMPTS = 20;

    const activityId = await createActivity({
      slug: 'concorrencia-basica',
      capacity: CAPACITY,
      waitlistEnabled: false,
    });
    const userIds = await createUsers(ATTEMPTS);

    /**
     * O ponto do teste: TODAS as tentativas partem ao mesmo tempo. Se a
     * implementação fizesse "contar e depois inserir", várias veriam 4
     * inscritos e todas passariam.
     */
    const results = await Promise.all(
      userIds.map((userId) =>
        registerForActivity({
          tenantId,
          eventSlug: 'evento-concorrencia',
          activitySlug: 'concorrencia-basica',
          userId,
          consentData: true,
        }),
      ),
    );

    const confirmed = results.filter((r) => r.ok && r.status === 'CONFIRMED');
    const rejected = results.filter((r) => !r.ok);

    // ── A asserção central ─────────────────────────────────────────────────
    expect(confirmed).toHaveLength(CAPACITY);
    expect(rejected).toHaveLength(ATTEMPTS - CAPACITY);

    // Todas as rejeições são por lotação — não por erro inesperado.
    for (const result of rejected) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FULL');
    }

    // ── Consistência com o banco ───────────────────────────────────────────
    const state = await readState(activityId);

    expect(state.confirmedRows).toBe(CAPACITY);
    expect(state.activity.confirmedCount).toBe(CAPACITY);
    // O contador denormalizado NUNCA pode passar da capacidade.
    expect(state.activity.confirmedCount).toBeLessThanOrEqual(CAPACITY);
    // E precisa bater com a contagem real de linhas.
    expect(state.activity.confirmedCount).toBe(state.confirmedRows);
  }, 60_000);

  it('excedente vai para a lista de espera, com posições FIFO contíguas', async () => {
    const CAPACITY = 3;
    const ATTEMPTS = 12;

    const activityId = await createActivity({
      slug: 'concorrencia-espera',
      capacity: CAPACITY,
      waitlistEnabled: true,
    });
    const userIds = await createUsers(ATTEMPTS);

    const results = await Promise.all(
      userIds.map((userId) =>
        registerForActivity({
          tenantId,
          eventSlug: 'evento-concorrencia',
          activitySlug: 'concorrencia-espera',
          userId,
          consentData: true,
        }),
      ),
    );

    const confirmed = results.filter((r) => r.ok && r.status === 'CONFIRMED');
    const waitlisted = results.filter((r) => r.ok && r.status === 'WAITLISTED');
    const failed = results.filter((r) => !r.ok);

    // Diagnóstico: se algo não virar CONFIRMED nem WAITLISTED, precisamos saber
    // exatamente qual código veio — sem isso, um bug de retry fica invisível.
    expect(
      failed.map((f) => (f.ok ? 'ok' : `${f.code}: ${f.message}`)),
      'nenhuma inscrição deveria falhar: as vagas e a espera absorvem todas',
    ).toEqual([]);

    expect(confirmed).toHaveLength(CAPACITY);
    expect(waitlisted).toHaveLength(ATTEMPTS - CAPACITY);

    const state = await readState(activityId);
    expect(state.confirmedRows).toBe(CAPACITY);
    expect(state.waitlistedRows).toBe(ATTEMPTS - CAPACITY);
    expect(state.activity.confirmedCount).toBe(CAPACITY);
    expect(state.activity.waitlistCount).toBe(ATTEMPTS - CAPACITY);

    // ── Posições FIFO sem buracos ──────────────────────────────────────────
    const positions = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { activityId, status: 'WAITLISTED' },
        orderBy: { waitlistPosition: 'asc' },
        select: { waitlistPosition: true },
      }),
    );

    const numbers = positions.map((p) => p.waitlistPosition ?? 0).sort((a, b) => a - b);
    expect(numbers).toEqual(
      Array.from({ length: ATTEMPTS - CAPACITY }, (_, index) => index + 1),
    );
  }, 60_000);

  it('capacidade ILIMITADA (null) não rejeita ninguém', async () => {
    const ATTEMPTS = 15;

    const activityId = await createActivity({
      slug: 'concorrencia-ilimitada',
      capacity: null,
      waitlistEnabled: false,
    });
    const userIds = await createUsers(ATTEMPTS);

    const results = await Promise.all(
      userIds.map((userId) =>
        registerForActivity({
          tenantId,
          eventSlug: 'evento-concorrencia',
          activitySlug: 'concorrencia-ilimitada',
          userId,
          consentData: true,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(ATTEMPTS);

    const state = await readState(activityId);
    expect(state.activity.confirmedCount).toBe(ATTEMPTS);
    expect(state.activity.capacity).toBeNull();
  }, 60_000);

  it('capacidade ZERO rejeita todas as tentativas', async () => {
    const ATTEMPTS = 6;

    const activityId = await createActivity({
      slug: 'concorrencia-zero',
      capacity: 0,
      waitlistEnabled: false,
    });
    const userIds = await createUsers(ATTEMPTS);

    const results = await Promise.all(
      userIds.map((userId) =>
        registerForActivity({
          tenantId,
          eventSlug: 'evento-concorrencia',
          activitySlug: 'concorrencia-zero',
          userId,
          consentData: true,
        }),
      ),
    );

    // `0` significa ESGOTADO. Tratar como "ilimitado" seria o bug clássico.
    expect(results.filter((r) => r.ok)).toHaveLength(0);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FULL');
    }

    const state = await readState(activityId);
    expect(state.activity.confirmedCount).toBe(0);
    expect(state.confirmedRows).toBe(0);
  }, 60_000);

  it('o mesmo usuário tentando 10 vezes simultâneas gera UMA única inscrição', async () => {
    const activityId = await createActivity({
      slug: 'concorrencia-duplicada',
      capacity: 50,
      waitlistEnabled: false,
    });
    const [userId] = await createUsers(1);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        registerForActivity({
          tenantId,
          eventSlug: 'evento-concorrencia',
          activitySlug: 'concorrencia-duplicada',
          userId: userId!,
          consentData: true,
        }),
      ),
    );

    const succeeded = results.filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);

    const state = await readState(activityId);
    expect(state.confirmedRows).toBe(1);
    expect(state.activity.confirmedCount).toBe(1);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cancelamento e promoção da lista de espera', () => {
  it('cancelar libera a vaga e promove o primeiro da fila', async () => {
    const CAPACITY = 2;

    const activityId = await createActivity({
      slug: 'cancelamento-promocao',
      capacity: CAPACITY,
      waitlistEnabled: true,
    });
    const userIds = await createUsers(4);

    const results = await Promise.all(
      userIds.map((userId) =>
        registerForActivity({
          tenantId,
          eventSlug: 'evento-concorrencia',
          activitySlug: 'cancelamento-promocao',
          userId,
          consentData: true,
        }),
      ),
    );

    const confirmed = results.filter((r) => r.ok && r.status === 'CONFIRMED');
    expect(confirmed).toHaveLength(CAPACITY);

    // Identifica quem está confirmado e quem está em primeiro na espera.
    const before = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { activityId },
        select: { id: true, userId: true, status: true, waitlistPosition: true },
      }),
    );

    const confirmedRows = before.filter((r) => r.status === 'CONFIRMED');
    const firstInLine = before
      .filter((r) => r.status === 'WAITLISTED')
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))[0]!;

    // ── Cancela uma inscrição confirmada ───────────────────────────────────
    const victim = confirmedRows[0]!;
    const cancelResult = await cancelRegistration({
      tenantId,
      registrationId: victim.id,
      userId: victim.userId,
    });

    expect(cancelResult.ok).toBe(true);
    if (cancelResult.ok) {
      expect(cancelResult.promoted).not.toBeNull();
      expect(cancelResult.promoted?.registrationId).toBe(firstInLine.id);
    }

    // ── O primeiro da fila foi promovido ───────────────────────────────────
    const promoted = await withTenant(tenantId, (tx) =>
      tx.registration.findUniqueOrThrow({
        where: { id: firstInLine.id },
        select: { status: true, waitlistPosition: true },
      }),
    );
    expect(promoted.status).toBe('CONFIRMED');
    expect(promoted.waitlistPosition).toBeNull();

    // ── Contadores permanecem consistentes ─────────────────────────────────
    const state = await readState(activityId);
    expect(state.confirmedRows).toBe(CAPACITY);
    expect(state.activity.confirmedCount).toBe(CAPACITY);
    expect(state.waitlistedRows).toBe(1);
    expect(state.activity.waitlistCount).toBe(1);

    // ── Posições da espera reindexadas para 1..n ───────────────────────────
    const remaining = await withTenant(tenantId, (tx) =>
      tx.registration.findMany({
        where: { activityId, status: 'WAITLISTED' },
        select: { waitlistPosition: true },
      }),
    );
    expect(remaining.map((r) => r.waitlistPosition)).toEqual([1]);
  }, 60_000);

  it('cancelar não infla a lotação disponível (transição inválida é recusada)', async () => {
    const activityId = await createActivity({
      slug: 'cancelamento-duplo',
      capacity: 1,
      waitlistEnabled: false,
    });
    const userIds = await createUsers(2);

    const first = await registerForActivity({
      tenantId,
      eventSlug: 'evento-concorrencia',
      activitySlug: 'cancelamento-duplo',
      userId: userIds[0]!,
      consentData: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Primeiro cancelamento: libera a vaga.
    const cancel1 = await cancelRegistration({
      tenantId,
      registrationId: first.registrationId,
      userId: userIds[0]!,
    });
    expect(cancel1.ok).toBe(true);

    let state = await readState(activityId);
    expect(state.activity.confirmedCount).toBe(0);

    /**
     * Segundo cancelamento da MESMA inscrição: precisa ser recusado.
     * Se fosse aceito, o contador iria para -1 (ou ficaria 0 com GREATEST) e a
     * vaga extra permitiria superlotação por cancelamentos repetidos.
     */
    const cancel2 = await cancelRegistration({
      tenantId,
      registrationId: first.registrationId,
      userId: userIds[0]!,
    });
    expect(cancel2.ok).toBe(false);
    if (!cancel2.ok) expect(cancel2.code).toBe('INVALID_TRANSITION');

    state = await readState(activityId);
    expect(state.activity.confirmedCount).toBe(0);
    expect(state.activity.confirmedCount).toBeGreaterThanOrEqual(0);

    // Confirma que a vaga liberada pode ser de fato usada por outro.
    const second = await registerForActivity({
      tenantId,
      eventSlug: 'evento-concorrencia',
      activitySlug: 'cancelamento-duplo',
      userId: userIds[1]!,
      consentData: true,
    });
    expect(second.ok).toBe(true);

    state = await readState(activityId);
    expect(state.activity.confirmedCount).toBe(1);
    expect(state.confirmedRows).toBe(1);
  }, 60_000);

  it('usuário não pode cancelar a inscrição de outra pessoa', async () => {
    const activityId = await createActivity({
      slug: 'cancelamento-alheio',
      capacity: 5,
      waitlistEnabled: false,
    });
    const userIds = await createUsers(2);

    const registration = await registerForActivity({
      tenantId,
      eventSlug: 'evento-concorrencia',
      activitySlug: 'cancelamento-alheio',
      userId: userIds[0]!,
      consentData: true,
    });
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;

    // Tentativa de cancelar com o userId de OUTRA pessoa.
    const attack = await cancelRegistration({
      tenantId,
      registrationId: registration.registrationId,
      userId: userIds[1]!,
    });

    expect(attack.ok).toBe(false);
    if (!attack.ok) expect(attack.code).toBe('NOT_REGISTERED');

    // A inscrição continua intacta.
    const state = await readState(activityId);
    expect(state.confirmedRows).toBe(1);
    expect(state.activity.confirmedCount).toBe(1);
  }, 60_000);
});
