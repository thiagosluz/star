/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — crachá, credenciamento e frequência (FASE 31)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança:
 *    • o crachá nasce por pessoa no evento (um código opaco), e a emissão é idempotente;
 *    • CREDENCIAMENTO ≠ FREQUÊNCIA: a portaria grava "chegou" e a atividade grava
 *      "esteve aqui, por N minutos" — são fatos separados, com contas separadas;
 *    • presença de quem NÃO tem inscrição é registrada, com aviso (a decisão da fase);
 *    • a janela declarada da atividade (`checkInEnabled`/`checkInOpensAt`/`ClosesAt`) é
 *      respeitada — antes desta fase, desligar o credenciamento não impedia nada;
 *    • a revogação tira o crachá de circulação sem perder de quem ele era;
 *    • dois leitores do MESMO crachá, ao mesmo tempo, produzem UMA sessão;
 *    • o fechamento automático grava a saída no FIM DA ATIVIDADE, e o mesmo número
 *      sempre;
 *    • o crachá online nasce na primeira abertura da própria pessoa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listAuditLog } from '../../src/lib/admin/audit';
import {
  closeOpenSessions,
  getOwnCredential,
  issueCredentials,
  listCredentialRoster,
  readCredential,
  recordCredentialPresence,
  revokeCredential,
} from '../../src/lib/events/credential-service';
import { runAttendanceSweep } from '../../src/lib/events/attendance-sweep';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

/** Uma atividade que JÁ terminou (para o fechamento automático) e uma em curso. */
const pastStart = new Date('2026-09-21T12:00:00.000Z');
const pastEnd = new Date('2026-09-21T13:00:00.000Z');
const liveStart = new Date('2026-09-21T15:00:00.000Z');
const liveEnd = new Date('2026-09-21T17:00:00.000Z');

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let actorId: string;
let pastActivityId: string;
let liveActivityId: string;
let closedActivityId: string;

const people: Record<string, string> = {};

async function createPerson(name: string, tenant = tenantId): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f31.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId: tenant, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

async function register(userId: string, activityId: string | null, status = 'CONFIRMED'): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.registration.create({
      data: {
        id,
        tenantId,
        eventId,
        activityId,
        userId,
        status: status as 'CONFIRMED',
      },
    }),
  );

  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  pastActivityId = randomUUID();
  liveActivityId = randomUUID();
  closedActivityId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f31-${RUN}`,
        name: `Instituição Crachá ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f31-outra-${RUN}`,
        name: `Outra Instituição ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-f31',
        title: 'Congresso F31',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-09-21T11:00:00.000Z'),
        endsAt: new Date('2026-09-21T22:00:00.000Z'),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
      },
    });

    // ── Uma atividade que JÁ terminou (é a que o fechamento automático fecha) ──
    await tx.activity.create({
      data: {
        id: pastActivityId,
        tenantId,
        eventId,
        slug: 'oficina-passada',
        title: 'Oficina que já terminou',
        type: 'WORKSHOP',
        status: 'COMPLETED',
        modality: 'IN_PERSON',
        startsAt: pastStart,
        endsAt: pastEnd,
        workloadMinutes: 60,
        requiresAttendance: true,
      },
    });

    // ── Uma atividade acontecendo (janela aberta) ─────────────────────────────
    await tx.activity.create({
      data: {
        id: liveActivityId,
        tenantId,
        eventId,
        slug: 'oficina-agora',
        title: 'Oficina de agora',
        type: 'WORKSHOP',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: liveStart,
        endsAt: liveEnd,
        workloadMinutes: 120,
        requiresAttendance: true,
      },
    });

    // ── Uma atividade com o credenciamento DESLIGADO ──────────────────────────
    await tx.activity.create({
      data: {
        id: closedActivityId,
        tenantId,
        eventId,
        slug: 'oficina-fechada',
        title: 'Oficina com credenciamento desligado',
        type: 'WORKSHOP',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: liveStart,
        endsAt: liveEnd,
        workloadMinutes: 120,
        requiresAttendance: true,
        checkInEnabled: false,
      },
    });
  });

  actorId = await createPerson('Monitora do balcão');

  people.ana = await createPerson('Ana Crachá');
  people.bruno = await createPerson('Bruno Crachá');
  people.carla = await createPerson('Carla Crachá');
  people.diego = await createPerson('Diego Crachá');

  // Ana: inscrita no evento e na oficina de agora. Bruno: só no evento.
  // Carla: só na oficina de agora (sem inscrição no evento). Diego: sem inscrição.
  await register(people.ana, null);
  await register(people.ana, liveActivityId);
  await register(people.bruno, null);
  await register(people.carla, liveActivityId);
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a lista de participantes e a emissão de crachás', () => {
  it('lista quem tem inscrição no evento OU em atividade, e quem não tem', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId });

    expect(roster.ok).toBe(true);
    if (!roster.ok) return;

    const ids = roster.entries.map((entry) => entry.userId);

    expect(ids).toContain(people.ana);
    expect(ids).toContain(people.bruno);
    expect(ids).toContain(people.carla);
    // Quem não tem inscrição nenhuma não aparece até receber crachá à mão.
    expect(ids).not.toContain(people.diego);
    expect(roster.withoutCredential).toBeGreaterThanOrEqual(3);
  });

  it('emite UM crachá por pessoa, com código no formato novo', async () => {
    const issued = await issueCredentials({ tenantId, eventId, actorId });

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(issued.issued.length).toBeGreaterThanOrEqual(3);

    for (const entry of issued.issued) {
      expect(entry.code).toMatch(/^CR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }

    const codes = issued.issued.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('emitir de novo NÃO gera outro código (crachá na mão de alguém não muda)', async () => {
    const again = await issueCredentials({ tenantId, eventId, actorId });

    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.issued).toHaveLength(0);
    expect(again.skipped).toBeGreaterThanOrEqual(3);
  });

  it('emite para quem NÃO tem inscrição, quando a organização pede (equipe/visitante)', async () => {
    const issued = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [people.diego],
      notes: 'Equipe de apoio',
    });

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(issued.issued).toHaveLength(1);
    expect(issued.issued[0]!.userId).toBe(people.diego);

    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Diego' });

    expect(roster.ok).toBe(true);
    if (!roster.ok) return;

    expect(roster.entries[0]?.credential?.code).toBe(issued.issued[0]!.code);
    expect(roster.entries[0]?.registrations).toHaveLength(0);
  });

  it('a emissão entra na trilha de auditoria', async () => {
    const entries = await listAuditLog(tenantId, { limit: 50 });
    const created = entries.find((entry) => entry.entityType === 'credential' && entry.action === 'CREATE');

    expect(created).toBeDefined();
    expect(JSON.stringify(created?.changes)).toMatch(/CR-/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a leitura no balcão', () => {
  async function codeOf(userId: string): Promise<string> {
    const roster = await listCredentialRoster({ tenantId, eventId });

    if (!roster.ok) throw new Error('lista indisponível');

    const entry = roster.entries.find((row) => row.userId === userId);
    if (!entry?.credential) throw new Error('crachá ausente');

    return entry.credential.code;
  }

  it('identifica a pessoa sem gravar nada, e aceita o código digitado em qualquer caixa', async () => {
    const code = await codeOf(people.ana);
    const lower = await readCredential({
      tenantId,
      eventId,
      code: code.toLowerCase().replace(/-/g, ' '),
      context: { kind: 'EVENT', activityId: null },
    });

    expect(lower.ok).toBe(true);
    if (!lower.ok) return;

    expect(lower.target.userName).toBe('Ana Crachá');
    expect(lower.target.state).toBe('ACTIVE');
    expect(lower.target.registered).toBe(true);
    expect(lower.target.openSession).toBeNull();

    // Ler não grava: nenhuma presença nasceu.
    const count = await withTenant(tenantId, (tx) =>
      tx.attendance.count({ where: { tenantId, userId: people.ana } }),
    );
    expect(count).toBe(0);
  });

  /**
   * O crachá impresso ANTES da FASE 31 continua valendo: o token vive na coluna
   * antiga (`registrations.badgeToken`), o QR carrega aquele texto e a etiqueta está
   * na mão da pessoa.
   *
   * O token da fixture tem CAIXA MISTA de propósito. O código novo é nosso e pode ser
   * normalizado, mas o legado é string opaca: promover a maiúsculas antes de procurar
   * deixava este crachá invisível para o balcão — o E2E da jornada encontrou o defeito,
   * e nenhum teste de integração olhava para este caminho.
   */
  it('o token LEGADO da inscrição é encontrado na caixa exata e vira crachá com o mesmo código', async () => {
    const legacyUserId = await createPerson('Legado do Balcão');
    const legacyToken = `badge-plat-${RUN}-aB`;

    await withTenant(tenantId, (tx) =>
      tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: null,
          userId: legacyUserId,
          status: 'CONFIRMED',
          badgeToken: legacyToken,
        },
      }),
    );

    const read = await readCredential({
      tenantId,
      eventId,
      code: legacyToken,
      context: { kind: 'EVENT', activityId: null },
    });

    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.target.userId).toBe(legacyUserId);
    expect(read.target.code).toBe(legacyToken);
    expect(read.target.registered).toBe(true);

    // A leitura MATERIALIZA o crachá com o MESMO código — nada é reimpresso.
    const stored = await withTenant(tenantId, (tx) =>
      tx.eventCredential.findFirst({
        where: { tenantId, userId: legacyUserId },
        select: { code: true, status: true },
      }),
    );

    expect(stored?.code).toBe(legacyToken);
    expect(stored?.status).toBe('ACTIVE');
  });

  it('crachá de outra instituição não é encontrado (RLS + código global)', async () => {
    const code = await codeOf(people.ana);

    const result = await readCredential({
      tenantId: otherTenantId,
      eventId,
      code,
      context: { kind: 'EVENT', activityId: null },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('credenciamento (portaria) é diferente de frequência (atividade)', () => {
  it('a portaria grava a CHEGADA e marca a inscrição do evento', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Bruno' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const result = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'EVENT', activityId: null },
      actorId,
      mode: 'IN',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.action).toBe('CHECKED_IN');
    expect(result.target.arrivedAt).not.toBeNull();

    const attendance = await withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, userId: people.bruno },
        select: { activityId: true, registrationId: true, source: true },
      }),
    );

    // A chegada é uma presença SEM atividade — e com a inscrição do evento ligada.
    expect(attendance).toHaveLength(1);
    expect(attendance[0]?.activityId).toBeNull();
    expect(attendance[0]?.registrationId).not.toBeNull();

    const registration = await withTenant(tenantId, (tx) =>
      tx.registration.findFirst({
        where: { tenantId, eventId, userId: people.bruno, activityId: null },
        select: { checkedInAt: true, status: true },
      }),
    );

    expect(registration?.checkedInAt).not.toBeNull();
    expect(registration?.status).toBe('ATTENDED');
  });

  it('a leitura repetida na portaria não duplica a chegada', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Bruno' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const again = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'EVENT', activityId: null },
      actorId,
      mode: 'IN',
    });

    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.action).toBe('ALREADY_INSIDE');

    const count = await withTenant(tenantId, (tx) =>
      tx.attendance.count({ where: { tenantId, userId: people.bruno, activityId: null } }),
    );

    expect(count).toBe(1);
  });

  it('a frequência na atividade é um fato SEPARADO, com minutos', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Ana' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const enter = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T15:00:00.000Z'),
    });

    expect(enter.ok).toBe(true);
    if (!enter.ok) return;
    expect(enter.action).toBe('CHECKED_IN');
    expect(enter.warnings).toEqual([]);

    const exit = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'OUT',
      now: new Date('2026-09-21T16:00:00.000Z'),
    });

    expect(exit.ok).toBe(true);
    if (!exit.ok) return;

    expect(exit.action).toBe('CHECKED_OUT');
    expect(exit.minutes).toBe(60);

    /** As DUAS presenças existem: a chegada (sem atividade) e a frequência. */
    const rows = await withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, userId: people.ana },
        orderBy: { checkedInAt: 'asc' },
        select: { activityId: true, minutesAttended: true, checkedOutAt: true },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.activityId).toBe(liveActivityId);
    expect(rows[0]?.minutesAttended).toBe(60);

    const rosterAfter = await listCredentialRoster({ tenantId, eventId, query: 'Ana' });

    expect(rosterAfter.ok).toBe(true);
    if (!rosterAfter.ok) return;

    expect(rosterAfter.entries[0]?.attendedActivities).toBe(1);
    expect(rosterAfter.entries[0]?.minutesAttended).toBe(60);
    // Ana não passou pela portaria ainda: chegada e frequência são fatos distintos.
    expect(rosterAfter.entries[0]?.arrivedAt).toBeNull();
  });

  it('os minutos param no FIM DA ATIVIDADE (esquecer de sair não rende tempo)', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Carla' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T15:00:00.000Z'),
    });

    // A saída acontece às 20h, mas a oficina terminou às 17h.
    const exit = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'OUT',
      now: new Date('2026-09-21T20:00:00.000Z'),
    });

    expect(exit.ok).toBe(true);
    if (!exit.ok) return;

    expect(exit.minutes).toBe(120);
  });

  it('a SEGUNDA visita à mesma atividade abre uma sessão NOVA (e os minutos somam)', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Ana' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    /**
     * Ana já esteve nesta atividade (a inscrição dela está credenciada). A pessoa sai
     * para o almoço e volta: é OUTRO fato, com os minutos dele.
     *
     * Antes desta correção, a segunda leitura caía no `checkIn` de sempre — que é
     * idempotente por `registration.checkedInAt` — e respondia "já credenciado" SEM
     * abrir sessão: a tarde inteira da pessoa desaparecia da conta.
     */
    const segunda = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T16:30:00.000Z'),
    });

    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;

    expect(segunda.action).toBe('CHECKED_IN');

    const saida = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'OUT',
      now: new Date('2026-09-21T16:45:00.000Z'),
    });

    expect(saida.ok).toBe(true);
    if (!saida.ok) return;

    expect(saida.minutes).toBe(15);

    // A última sessão é a da tarde: 15 minutos, e não a conta de uma visita só.
    const sessions = await withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, userId: people.ana, activityId: liveActivityId },
        orderBy: { checkedInAt: 'asc' },
        select: { checkedInAt: true, minutesAttended: true },
      }),
    );

    // A primeira visita (15h–16h) e esta da tarde: são DUAS sessões na mesma atividade.
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.at(-1)?.minutesAttended).toBe(15);
  });

  it('presença de quem NÃO tem inscrição é registrada, com aviso na tela', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Diego' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const result = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T15:30:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.action).toBe('CHECKED_IN');
    expect(result.target.registered).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/SEM inscrição/i);

    const session = await withTenant(tenantId, (tx) =>
      tx.attendance.findFirst({
        where: { tenantId, userId: people.diego, activityId: liveActivityId },
        select: { id: true, registrationId: true, source: true },
      }),
    );

    // A sessão existe, e SEM inscrição ligada — o fato é o que importa.
    expect(session).not.toBeNull();
    expect(session?.registrationId).toBeNull();
  });

  it('a janela declarada da atividade é respeitada', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Bruno' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const disabled = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: closedActivityId },
      actorId,
      mode: 'IN',
    });

    expect(disabled.ok).toBe(false);
    if (!disabled.ok) {
      expect(disabled.code).toBe('CHECKIN_DISABLED');
      expect(disabled.details?.[0]).toBe('Oficina com credenciamento desligado');
    }
  });

  it('a atividade encerrada ainda aceita a lista registrada depois (o fim não fecha sozinho)', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Carla' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const result = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: pastActivityId },
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T18:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('CHECKED_IN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('concorrência e fechamento automático', () => {
  it('DOIS leitores do MESMO crachá produzem UMA sessão', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Bruno' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    const [first, second] = await Promise.all([
      recordCredentialPresence({
        tenantId,
        eventId,
        code,
        context: { kind: 'ACTIVITY', activityId: pastActivityId },
        actorId,
        mode: 'IN',
      }),
      recordCredentialPresence({
        tenantId,
        eventId,
        code,
        context: { kind: 'ACTIVITY', activityId: pastActivityId },
        actorId,
        mode: 'IN',
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const actions = [first.ok ? first.action : null, second.ok ? second.action : null].sort();

    // Uma entrada e uma leitura que encontrou a sessão já aberta — nunca duas entradas.
    expect(actions).toEqual(['ALREADY_INSIDE', 'CHECKED_IN']);

    const count = await withTenant(tenantId, (tx) =>
      tx.attendance.count({
        where: { tenantId, userId: people.bruno, activityId: pastActivityId, checkedOutAt: null },
      }),
    );

    expect(count).toBe(1);
  });

  it('o fechamento automático grava a saída no FIM da atividade — e o número não depende de quando roda', async () => {
    const cedo = await runAttendanceSweep({ now: new Date('2026-09-21T13:05:00.000Z') });

    expect(cedo.closed).toBeGreaterThanOrEqual(1);

    /**
     * A varredura é CROSS-TENANT e fecha tudo o que já venceu — então a segunda chamada
     * usa o MESMO instante: nada mais venceu, e repetir não fecha de novo (a saída já
     * está gravada).
     */
    const repetida = await runAttendanceSweep({ now: new Date('2026-09-21T13:05:00.000Z') });

    expect(repetida.closed).toBe(0);

    const session = await withTenant(tenantId, (tx) =>
      tx.attendance.findFirst({
        where: { tenantId, userId: people.bruno, activityId: pastActivityId },
        select: { checkedOutAt: true, minutesAttended: true, notes: true },
      }),
    );

    // Bruno entrou às 18h e a oficina terminou às 13h (o registro veio depois): zero
    // minuto — o teto do fim da atividade vale para os dois sentidos.
    expect(session?.checkedOutAt?.toISOString()).toBe(pastEnd.toISOString());
    expect(session?.minutesAttended).toBe(0);
    expect(session?.notes).toMatch(/fim da atividade/i);
  });

  it('o botão do painel fecha as presenças abertas do contexto', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Ana' });
    if (!roster.ok) throw new Error('lista indisponível');
    const code = roster.entries[0]!.credential!.code;

    /** Sessão PRÓPRIA do teste: as anteriores já foram fechadas pela varredura. */
    const open = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'ACTIVITY', activityId: liveActivityId },
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T16:00:00.000Z'),
    });

    expect(open.ok).toBe(true);
    if (!open.ok) throw new Error(open.message);

    /**
     * A asserção é sobre a SESSÃO QUE ESTE TESTE ABRIU (pelo id devolvido), e não
     * sobre "a última da pessoa": outro cenário pode ter aberto uma sessão depois, e
     * o teste passaria a medir a sessão alheia (armadilha 62).
     */
    const sessionId = open.attendanceId;

    const closed = await closeOpenSessions({
      tenantId,
      eventId,
      activityId: liveActivityId,
      actorId,
      now: new Date('2026-09-21T18:00:00.000Z'),
    });

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    expect(closed.closed).toBeGreaterThanOrEqual(1);

    const session = await withTenant(tenantId, (tx) =>
      tx.attendance.findUniqueOrThrow({
        where: { id: sessionId! },
        select: { minutesAttended: true, checkedOutAt: true, notes: true },
      }),
    );

    // Entrou às 16h, oficina termina às 17h: 60 minutos, com a saída no fim dela.
    expect(session?.minutesAttended).toBe(60);
    expect(session?.checkedOutAt?.toISOString()).toBe(liveEnd.toISOString());
    expect(session?.notes).toMatch(/fim da atividade/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('revogação do crachá', () => {
  it('revoga com motivo e a trilha guarda a mudança', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId, query: 'Diego' });
    if (!roster.ok) throw new Error('lista indisponível');
    const credentialId = roster.entries[0]!.credential!.id;
    const code = roster.entries[0]!.credential!.code;

    const revoked = await revokeCredential({
      tenantId,
      credentialId,
      actorId,
      reason: 'Crachá perdido na portaria',
    });

    expect(revoked.ok).toBe(true);

    const audit = await listAuditLog(tenantId, { limit: 20 });
    const entry = audit.find((row) => row.entityType === 'credential' && row.changes.reason);

    expect(entry).toBeDefined();
    expect(String(entry?.changes.reason?.to)).toBe('Crachá perdido na portaria');

    // O crachá continua sendo IDENTIFICÁVEL (o balcão precisa saber de quem era)...
    const read = await readCredential({
      tenantId,
      eventId,
      code,
      context: { kind: 'EVENT', activityId: null },
    });

    expect(read.ok).toBe(true);
    if (read.ok) expect(read.target.state).toBe('REVOKED');

    // ... mas não registra presença.
    const refused = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context: { kind: 'EVENT', activityId: null },
      actorId,
      mode: 'IN',
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('ALREADY_REVOKED');
  });

  it('reemitir cria um código NOVO e o antigo sai de circulação', async () => {
    const before = await listCredentialRoster({ tenantId, eventId, query: 'Diego' });
    if (!before.ok) throw new Error('lista indisponível');
    const oldCode = before.entries[0]!.credential!.code;

    const issued = await issueCredentials({ tenantId, eventId, actorId, userIds: [people.diego] });

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(issued.issued).toHaveLength(1);
    expect(issued.issued[0]!.code).not.toBe(oldCode);

    const after = await listCredentialRoster({ tenantId, eventId, query: 'Diego' });

    expect(after.ok).toBe(true);
    if (!after.ok) return;

    expect(after.entries[0]?.credential?.code).toBe(issued.issued[0]!.code);
    expect(after.entries[0]?.credential?.state).toBe('ACTIVE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o crachá online do participante', () => {
  it('nasce na primeira abertura e é idempotente', async () => {
    const first = await getOwnCredential({ tenantId, userId: people.carla, eventId });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.code).toMatch(/^CR-/);
    expect(first.qrPayload).toBe(first.code);
    expect(first.registrations.length).toBeGreaterThanOrEqual(1);

    const second = await getOwnCredential({ tenantId, userId: people.carla, eventId });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.credentialId).toBe(first.credentialId);
    expect(second.code).toBe(first.code);
  });

  it('quem não tem inscrição no evento não recebe crachá por esta porta', async () => {
    const stranger = await createPerson('Sem Inscrição F31');

    const result = await getOwnCredential({ tenantId, userId: stranger, eventId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_ELIGIBLE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * A PERGUNTA DO BALCÃO: "a pessoa já foi credenciada — e se eu ler o crachá de novo?"
 *
 * O monitor tem UM botão, e ele alterna (`TOGGLE`): entra quem está fora, sai quem
 * está dentro. Nenhum teste deste arquivo exercitava esse modo — só `IN` e `OUT` — e
 * é justamente ele que o balcão usa o dia inteiro. Estes cenários prendem a resposta,
 * inclusive a parte incômoda: **ler de novo quem já está dentro FECHA a presença**, em
 * vez de responder "já credenciado" (essa resposta existe, mas só para o modo `IN`).
 */
describe('leitura repetida do MESMO crachá', () => {
  async function personWithCredential(name: string, activityId: string | null): Promise<{ userId: string; code: string }> {
    const userId = await createPerson(name);
    await register(userId, activityId);

    const issued = await issueCredentials({ tenantId, eventId, actorId, userIds: [userId] });
    if (!issued.ok) throw new Error('crachá não emitido');

    return { userId, code: issued.issued[0]!.code };
  }

  function sessionsOf(userId: string, activityId: string | null) {
    return withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, userId, activityId },
        select: { checkedInAt: true, checkedOutAt: true, minutesAttended: true, registrationId: true },
        orderBy: { checkedInAt: 'asc' },
      }),
    );
  }

  function xpOf(userId: string) {
    return withTenant(tenantId, (tx) =>
      tx.xpTransaction.findMany({ where: { tenantId, userId }, select: { amount: true, source: true } }),
    );
  }

  it('na PORTARIA: a segunda leitura fecha a chegada e a terceira abre uma chegada NOVA, sem XP de novo', async () => {
    const { userId, code } = await personWithCredential('Repetição na Portaria', null);
    const context = { kind: 'EVENT' as const, activityId: null };

    const arrival = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'TOGGLE',
      now: new Date('2026-09-21T13:00:00.000Z'),
    });

    expect(arrival.ok).toBe(true);
    if (!arrival.ok) return;
    expect(arrival.action).toBe('CHECKED_IN');

    const xpAfterArrival = await xpOf(userId);
    expect(xpAfterArrival).toHaveLength(1);

    // Segunda leitura com o botão único: a pessoa está DENTRO, então o botão fecha.
    const second = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'TOGGLE',
      now: new Date('2026-09-21T13:30:00.000Z'),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe('CHECKED_OUT');
    expect(second.minutes).toBe(30);

    // Terceira leitura: a pessoa está fora, então o botão abre uma chegada NOVA —
    // e o XP NÃO se repete (a recompensa é por fato, não por leitura).
    const third = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'TOGGLE',
      now: new Date('2026-09-21T14:00:00.000Z'),
    });

    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.action).toBe('CHECKED_IN');
    expect(third.rewarded).toBe(false);

    const sessions = await sessionsOf(userId, null);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.checkedOutAt).not.toBeNull();
    expect(sessions[1]?.checkedOutAt).toBeNull();
    expect(await xpOf(userId)).toHaveLength(1);
  });

  it('com o modo ENTRADA (`IN`) explícito, quem já está dentro recebe "já credenciado" — e nada é duplicado', async () => {
    const { userId, code } = await personWithCredential('Entrada Explícita', null);
    const context = { kind: 'EVENT' as const, activityId: null };

    await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T13:00:00.000Z'),
    });

    const again = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T13:05:00.000Z'),
    });

    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.action).toBe('ALREADY_INSIDE');
    expect(again.warnings[0]).toMatch(/Entrada já registrada às/);
    expect(await sessionsOf(userId, null)).toHaveLength(1);
  });

  it('na ATIVIDADE, depois de entrada E saída, a leitura seguinte abre uma VISITA nova — e os minutos somam', async () => {
    const { userId, code } = await personWithCredential('Visita Repetida', liveActivityId);
    const context = { kind: 'ACTIVITY' as const, activityId: liveActivityId };

    const morning = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'TOGGLE',
      now: new Date('2026-09-21T15:00:00.000Z'),
    });
    expect(morning.ok).toBe(true);

    const lunch = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'TOGGLE',
      now: new Date('2026-09-21T16:00:00.000Z'),
    });

    expect(lunch.ok).toBe(true);
    if (!lunch.ok) return;
    expect(lunch.action).toBe('CHECKED_OUT');
    expect(lunch.minutes).toBe(60);

    // A tarde é OUTRO fato: sessão nova, ligada à MESMA inscrição da atividade.
    const afternoon = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'TOGGLE',
      now: new Date('2026-09-21T16:15:00.000Z'),
    });

    expect(afternoon.ok).toBe(true);
    if (!afternoon.ok) return;
    expect(afternoon.action).toBe('CHECKED_IN');

    const sessions = await sessionsOf(userId, liveActivityId);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.minutesAttended).toBe(60);
    expect(sessions[1]?.checkedOutAt).toBeNull();
    expect(sessions[1]?.registrationId).not.toBeNull();

    // O balcão enxerga a pessoa DENTRO da atividade (a sessão da tarde está aberta).
    const inside = await readCredential({ tenantId, eventId, code, context });

    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    expect(inside.target.openSession).not.toBeNull();
  });
});

describe('Resiliência de Balcão e Modos Estritos (FASE 35 · Dívidas E40 e E43)', () => {
  async function personWithCredential(name: string, activityId: string | null): Promise<{ userId: string; code: string }> {
    const userId = await createPerson(name);
    await register(userId, activityId);

    const issued = await issueCredentials({ tenantId, eventId, actorId, userIds: [userId] });
    if (!issued.ok) throw new Error('crachá não emitido');

    return { userId, code: issued.issued[0]!.code };
  }

  function sessionsOf(userId: string, activityId: string | null) {
    return withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, userId, activityId },
        select: { checkedInAt: true, checkedOutAt: true, minutesAttended: true, registrationId: true },
        orderBy: { checkedInAt: 'asc' },
      }),
    );
  }

  it('no modo IN, bip duplo não fecha o credenciamento nem altera a sessão aberta', async () => {
    const { userId, code } = await personWithCredential('Modo Entrada Estrito', liveActivityId);
    const context = { kind: 'ACTIVITY' as const, activityId: liveActivityId };

    // Primeiro bip: entrada normal
    const first = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T15:00:00.000Z'),
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.action).toBe('CHECKED_IN');

    // Segundo bip (acidental ou rajada do leitor de código de barras): modo IN preserva a entrada
    const second = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'IN',
      now: new Date('2026-09-21T15:00:02.000Z'),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe('ALREADY_INSIDE');

    // Confere que a sessão permanece aberta e não foi encerrada
    const sessions = await sessionsOf(userId, liveActivityId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.checkedOutAt).toBeNull();
  });

  it('no modo OUT, se não houver sessão aberta, avisa sem criar sessão fantasma', async () => {
    const { userId, code } = await personWithCredential('Modo Saida Estrito', liveActivityId);
    const context = { kind: 'ACTIVITY' as const, activityId: liveActivityId };

    const result = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'OUT',
      now: new Date('2026-09-21T15:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('NOT_INSIDE');
    expect(result.warnings).toContain('Não havia entrada registrada neste contexto — nada a fechar.');

    const sessions = await sessionsOf(userId, liveActivityId);
    expect(sessions).toHaveLength(0);
  });

  it('idempotência via idempotencyKey evita duplicação de presença em sincronizações repetidas', async () => {
    const { code } = await personWithCredential('Sincronizacao Idempotente', null);
    const context = { kind: 'EVENT' as const };
    const idempotencyKey = `idemp-${randomUUID()}`;
    const readAt = new Date('2026-09-21T14:30:00.000Z');

    const first = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'IN',
      readAt,
      idempotencyKey,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.action).toBe('CHECKED_IN');

    // Segunda chamada com a mesma chave (ex.: timeout na rede móvel e reenvio da fila)
    const second = await recordCredentialPresence({
      tenantId,
      eventId,
      code,
      context,
      actorId,
      mode: 'IN',
      readAt,
      idempotencyKey,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe('CHECKED_IN');
    expect(second.warnings).toContain('Leitura já sincronizada anteriormente (idempotente).');

    // Confere no banco que apenas um registro Attendance com esse qrNonce existe
    const attendances = await withTenant(tenantId, (tx) =>
      tx.attendance.findMany({
        where: { tenantId, qrNonce: idempotencyKey },
      }),
    );
    expect(attendances).toHaveLength(1);
    expect(attendances[0]?.checkedInAt.toISOString()).toBe(readAt.toISOString());
  });
});
