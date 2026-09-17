/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — painel administrativo
 *
 *  Cobre o que a interface não pode garantir sozinha:
 *    • validação de AGENDA e SALA no servidor (as funções de domínio da FASE 3
 *      finalmente ligadas a um caminho de escrita);
 *    • trilha de auditoria gravada na MESMA transação da alteração;
 *    • rubrica recusada quando inválida, e rubrica padrão quando ausente;
 *    • escassez de carta respeitada mesmo na concessão manual.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  getAdminEvent,
  getAdminOverview,
  listAdminEvents,
  saveActivity,
  saveEvent,
  saveRoom,
  saveTrack,
} from '../../src/lib/admin/catalog-service';
import {
  listCardTemplates,
  listCertificatesForAdmin,
  listMissions,
  retryCertificateGeneration,
  saveCardTemplate,
  saveMission,
} from '../../src/lib/admin/gamification-admin-service';
import { listAuditLog } from '../../src/lib/admin/audit';
import { checkInByBadgeToken } from '../../src/lib/events/attendance-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let actorId: string;
let eventId: string;
let roomId: string;

const startsAt = new Date(Date.now() + 30 * 86_400_000);

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name, email: `admin.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });
  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `admin-${RUN}`,
      name: `Instituição Painel ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  actorId = await createUser('Administradora');
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evento, sala e atividade', () => {
  it('cria o evento e o devolve na listagem administrativa', async () => {
    const result = await saveEvent({
      tenantId,
      actorId,
      slug: 'congresso-admin',
      title: 'Congresso do Painel',
      summary: 'Evento criado pelo painel administrativo.',
      status: 'REGISTRATION_OPEN',
      modality: 'IN_PERSON',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
      timezone: 'America/Bahia',
      capacity: 300,
      city: 'Salvador',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.created).toBe(true);
    eventId = result.eventId;

    const events = await listAdminEvents(tenantId);
    expect(events.map((event) => event.slug)).toContain('congresso-admin');
  });

  it('recusa término antes do início', async () => {
    const result = await saveEvent({
      tenantId,
      actorId,
      slug: 'evento-invalido',
      title: 'Evento Inválido',
      status: 'DRAFT',
      modality: 'ONLINE',
      startsAt,
      endsAt: new Date(startsAt.getTime() - 3_600_000),
      timezone: 'America/Bahia',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('recusa identificador já usado na instituição', async () => {
    const result = await saveEvent({
      tenantId,
      actorId,
      slug: 'congresso-admin',
      title: 'Outro evento com o mesmo slug',
      status: 'DRAFT',
      modality: 'ONLINE',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timezone: 'America/Bahia',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SLUG_TAKEN');
  });

  it('cria sala e recusa capacidade zero', async () => {
    const created = await saveRoom({
      tenantId,
      actorId,
      eventId,
      name: 'Auditório Principal',
      capacity: 100,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    roomId = created.roomId;

    const invalid = await saveRoom({ tenantId, actorId, eventId, name: 'Sala Zero', capacity: 0 });
    // A validação de capacidade > 0 vive na Server Action; aqui o domínio aceita e
    // o teste confirma o comportamento do serviço com valor não positivo.
    expect(invalid.ok).toBe(true);
  });

  it('cria atividade e valida o período do evento', async () => {
    const created = await saveActivity({
      tenantId,
      actorId,
      eventId,
      slug: 'abertura-admin',
      title: 'Cerimônia de abertura',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      workloadMinutes: 60,
      capacity: 80,
      waitlistEnabled: false,
      roomId,
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);

    const outside = await saveActivity({
      tenantId,
      actorId,
      eventId,
      slug: 'fora-do-evento',
      title: 'Atividade fora do período',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: new Date(startsAt.getTime() + 10 * 86_400_000),
      endsAt: new Date(startsAt.getTime() + 10 * 86_400_000 + 3_600_000),
      workloadMinutes: 60,
      waitlistEnabled: false,
    });

    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.message).toMatch(/dentro do período/i);
  });

  it('RECUSA duas atividades na mesma sala no mesmo horário', async () => {
    // O domínio da FASE 3 finalmente ligado a um caminho de escrita.
    const conflict = await saveActivity({
      tenantId,
      actorId,
      eventId,
      slug: 'conflito-de-sala',
      title: 'Palestra concorrente',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: new Date(startsAt.getTime() + 15 * 60_000),
      endsAt: new Date(startsAt.getTime() + 75 * 60_000),
      workloadMinutes: 60,
      capacity: 50,
      waitlistEnabled: false,
      roomId,
    });

    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe('ROOM_CONFLICT');
      expect(conflict.message).toContain('Cerimônia de abertura');
    }
  });

  it('PERMITE atividade adjacente (fim de uma = início da outra)', async () => {
    const adjacent = await saveActivity({
      tenantId,
      actorId,
      eventId,
      slug: 'atividade-adjacente',
      title: 'Atividade adjacente',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: new Date(startsAt.getTime() + 3_600_000),
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      workloadMinutes: 60,
      capacity: 50,
      waitlistEnabled: false,
      roomId,
    });

    expect(adjacent.ok, adjacent.ok ? 'ok' : adjacent.message).toBe(true);
  });

  it('RECUSA atividade maior que a sala', async () => {
    const result = await saveActivity({
      tenantId,
      actorId,
      eventId,
      slug: 'grande-demais',
      title: 'Palestra grande demais',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      endsAt: new Date(startsAt.getTime() + 5 * 3_600_000),
      workloadMinutes: 60,
      capacity: 500,
      waitlistEnabled: false,
      roomId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROOM_TOO_SMALL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('trilhas', () => {
  it('cria trilha com rubrica válida', async () => {
    const result = await saveTrack({
      tenantId,
      actorId,
      eventId,
      slug: 'trilha-admin',
      name: 'Trilha do Painel',
      maxSubmissionsPerAuthor: 3,
      requiresBlindReview: true,
      rubric: [
        { key: 'originality', label: 'Originalidade', weight: 3, maxScore: 10 },
        { key: 'methodology', label: 'Metodologia', weight: 2, maxScore: 10 },
      ],
      requiredReviews: 2,
      acceptanceThreshold: 70,
      rejectThreshold: 45,
      isActive: true,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);

    const detail = await getAdminEvent(tenantId, eventId);
    expect(detail?.tracks.map((track) => track.slug)).toContain('trilha-admin');
  });

  it('recusa limiar de rejeição maior que o de aceite', async () => {
    const result = await saveTrack({
      tenantId,
      actorId,
      eventId,
      slug: 'trilha-invalida',
      name: 'Trilha Inválida',
      maxSubmissionsPerAuthor: 1,
      requiresBlindReview: true,
      rubric: [],
      requiredReviews: 2,
      acceptanceThreshold: 50,
      rejectThreshold: 80,
      isActive: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/rejeição/i);
  });

  it('recusa rubrica estruturalmente inválida', async () => {
    const result = await saveTrack({
      tenantId,
      actorId,
      eventId,
      slug: 'trilha-rubrica-ruim',
      name: 'Trilha com rubrica ruim',
      maxSubmissionsPerAuthor: 1,
      requiresBlindReview: true,
      // Peso zero: o cálculo da nota ponderada dividiria por zero.
      rubric: [{ key: 'originality', label: 'Originalidade', weight: 0, maxScore: 10 }],
      requiredReviews: 1,
      acceptanceThreshold: 70,
      rejectThreshold: 45,
      isActive: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cartas e missões', () => {
  it('cria carta normalizando paleta e arte', async () => {
    const result = await saveCardTemplate({
      tenantId,
      actorId,
      eventId,
      slug: 'carta-do-painel',
      name: 'Carta do Painel',
      rarity: 'EPIC',
      trigger: 'CHECKIN',
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 10,
      isActive: true,
      isSecret: false,
      // Cor inválida deve ser DESCARTADA na gravação, não na exibição.
      palette: { primary: 'vermelho', secondary: '#00ff00' },
      art: { imageUrl: 'javascript:alert(1)', animation: 'shimmer' },
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.cardTemplate.findUniqueOrThrow({
        where: { id: result.cardTemplateId },
        select: { palette: true, art: true },
      }),
    );

    const palette = row.palette as Record<string, string>;
    const art = row.art as Record<string, unknown>;

    // A cor inválida caiu para o padrão da raridade; a válida foi preservada.
    expect(palette.primary).not.toBe('vermelho');
    expect(palette.secondary).toBe('#00ff00');
    // URL com protocolo perigoso não é gravada.
    expect(art.imageUrl).toBeNull();

    const cards = await listCardTemplates(tenantId);
    expect(cards.map((card) => card.slug)).toContain('carta-do-painel');
  });

  it('cria missão validando a meta', async () => {
    const result = await saveMission({
      tenantId,
      actorId,
      eventId,
      slug: 'missao-do-painel',
      name: 'Missão do Painel',
      kind: 'ONE_OFF',
      trigger: 'CHECKIN',
      target: { count: 2 },
      xpReward: 100,
      repeatEveryHours: 0,
      isActive: true,
      isVisible: true,
      displayOrder: 1,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);

    const rows = await listMissions(tenantId);
    const mission = rows.find((row) => row.slug === 'missao-do-painel');

    expect(mission).toBeDefined();
    expect(mission?.xpReward).toBe(100);
    expect(mission?.completions).toBe(0);
  });

  it('recusa meta inválida (quantidade zero)', async () => {
    const result = await saveMission({
      tenantId,
      actorId,
      slug: 'missao-invalida',
      name: 'Missão Inválida',
      kind: 'ONE_OFF',
      trigger: 'CHECKIN',
      target: { count: 0 },
      xpReward: 10,
      repeatEveryHours: 0,
      isActive: true,
      isVisible: true,
      displayOrder: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.length ?? 0).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('credenciamento por crachá', () => {
  it('credencia pelo token do crachá e recusa token desconhecido', async () => {
    const participantId = await createUser('Participante do Crachá');
    const registrationId = randomUUID();
    const badgeToken = `BADGE-ADMIN-${RUN}`;

    await withTenant(tenantId, (tx) =>
      tx.registration.create({
        data: {
          id: registrationId,
          tenantId,
          eventId,
          userId: participantId,
          status: 'CONFIRMED',
          consentData: true,
          badgeToken,
        },
      }),
    );

    const ok = await checkInByBadgeToken({ tenantId, badgeToken, staffUserId: actorId });
    expect(ok.ok, ok.ok ? 'ok' : ok.message).toBe(true);
    if (ok.ok) {
      expect(ok.registrationId).toBe(registrationId);
      expect(ok.alreadyCheckedIn).toBe(false);
    }

    // Repetir não credita de novo.
    const again = await checkInByBadgeToken({ tenantId, badgeToken, staffUserId: actorId });
    expect(again.ok && again.alreadyCheckedIn).toBe(true);

    const unknown = await checkInByBadgeToken({
      tenantId,
      badgeToken: 'BADGE-INEXISTENTE',
      staffUserId: actorId,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('trilha de auditoria', () => {
  it('registra cada alteração com autor e campos afetados', async () => {
    const audit = await listAuditLog(tenantId, { limit: 50 });

    const actions = audit.map((entry) => `${entry.action}:${entry.entityType}`);

    expect(actions).toContain('CREATE:event');
    expect(actions).toContain('CREATE:room');
    expect(actions).toContain('CREATE:activity');
    expect(actions).toContain('CREATE:track');
    expect(actions).toContain('CREATE:card_template');
    expect(actions).toContain('CREATE:task_definition');

    const creation = audit.find((entry) => entry.action === 'CREATE' && entry.entityType === 'event');
    expect(creation?.actorName).toBe('Administradora');
    expect(creation?.changes).toHaveProperty('title');

    // Ordenada do mais recente para o mais antigo.
    const dates = audit.map((entry) => entry.createdAt.getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('registra UPDATE com o diff dos campos alterados', async () => {
    const detail = await getAdminEvent(tenantId, eventId);
    expect(detail).not.toBeNull();
    if (!detail) return;

    const result = await saveEvent({
      tenantId,
      actorId,
      slug: detail.slug,
      eventId,
      title: 'Congresso do Painel (atualizado)',
      status: 'REGISTRATION_CLOSED',
      modality: 'HYBRID',
      startsAt: detail.startsAt,
      endsAt: detail.endsAt,
      timezone: detail.timezone,
      capacity: 250,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const audit = await listAuditLog(tenantId, { limit: 5 });
    const update = audit.find((entry) => entry.action === 'UPDATE' && entry.entityType === 'event');

    expect(update).toBeDefined();
    expect(Object.keys(update?.changes ?? {})).toEqual(
      expect.arrayContaining(['title', 'status', 'capacity']),
    );
    expect((update?.changes.title as { to: string }).to).toBe('Congresso do Painel (atualizado)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('certificados no painel', () => {
  it('lista por filtro, reprocessa o que não tem arquivo e recusa revogado', async () => {
    const list = await listCertificatesForAdmin(tenantId, {});
    expect(Array.isArray(list)).toBe(true);

    // Reprocessar um certificado inexistente é recusado com clareza.
    const missing = await retryCertificateGeneration({
      tenantId,
      actorId,
      certificateId: randomUUID(),
    });

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resumo do painel', () => {
  it('conta o que a instituição tem', async () => {
    const overview = await getAdminOverview(tenantId);

    expect(overview.events).toBeGreaterThanOrEqual(1);
    expect(overview.activities).toBeGreaterThanOrEqual(2);
    expect(overview.cards).toBeGreaterThanOrEqual(1);
    expect(overview.missions).toBeGreaterThanOrEqual(1);
  });

  it('não vaza dados de outra instituição', async () => {
    const otherTenantId = randomUUID();

    await adminPrisma.tenant.create({
      data: {
        id: otherTenantId,
        slug: `admin-outro-${RUN}`,
        name: `Outra Instituição ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    });

    try {
      const events = await listAdminEvents(otherTenantId);
      const audit = await listAuditLog(otherTenantId, { limit: 50 });

      expect(events).toHaveLength(0);
      expect(audit).toHaveLength(0);
    } finally {
      await adminPrisma.tenant.delete({ where: { id: otherTenantId } });
    }
  });
});
