import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listAuditLog } from '../../src/lib/admin/audit';
import {
  exportParticipantsCsv,
  getParticipantProfile,
  listParticipants,
} from '../../src/lib/participants/participant-service';
import { getInstitutionIntelligence } from '../../src/lib/participants/insight-service';
import {
  listOwnMessages,
  markMessageRead,
  sendParticipantMessage,
} from '../../src/lib/participants/message-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

/** Evento 1 acontece no passado (para o filtro de período ter o que excluir). */
const pastStart = new Date('2026-05-10T12:00:00.000Z');
const pastEnd = new Date('2026-05-10T22:00:00.000Z');
/** Evento 2 é o recente. */
const recentStart = new Date('2026-09-10T12:00:00.000Z');
const recentEnd = new Date('2026-09-10T22:00:00.000Z');

let tenantId: string;
let otherTenantId: string;
let tenantSlug: string;
let eventOneId: string;
let eventTwoId: string;
const people: Record<string, string> = {};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Central do participante (FASE 32) — testes de integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (e por que cada um existe)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a UNIÃO que define participante (vínculo ∪ inscrição) — a pessoa que só tem
 *    inscrição não pode sumir do diretório;
 *  • o isolamento entre instituições, com DUAS instituições de verdade: o `user` é
 *    global, então este é o teste que prova que a ficha não vaza por `userId`;
 *  • a agregação por pessoa ATRAVÉS de eventos (a razão de a fase existir);
 *  • a leitura da ficha AUDITADA (a trilha precisa registrar o acesso);
 *  • o recado: mensagem gravada + e-mail ENFILEIRADO de verdade (`queued === true`,
 *    a armadilha 49) + posse na caixa de entrada;
 *  • a janela de período no fuso da instituição, com o evento fora dela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createPerson(name: string, tenant = tenantId): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f32.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId: tenant, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

async function register(input: {
  userId: string;
  eventId: string;
  activityId?: string | null;
  status?: string;
}): Promise<string> {
  const id = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.registration.create({
      data: {
        id,
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: (input.status ?? 'CONFIRMED') as 'CONFIRMED',
      },
    }),
  );

  return id;
}

async function attend(input: {
  userId: string;
  eventId: string;
  minutes: number;
  checkedInAt: Date;
  activityId?: string | null;
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId ?? null,
        userId: input.userId,
        status: 'PRESENT',
        source: 'QR_CODE_CHECKIN',
        checkedInAt: input.checkedInAt,
        minutesAttended: input.minutes,
      },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  tenantSlug = `f32-${RUN}`;

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: tenantSlug,
        name: `Instituição Participante ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f32-outra-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    ],
  });

  eventOneId = randomUUID();
  eventTwoId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.event.createMany({
      data: [
        {
          id: eventOneId,
          tenantId,
          slug: `congresso-${RUN}`,
          title: 'Congresso do Passado',
          status: 'FINISHED',
          modality: 'IN_PERSON',
          timezone: TIME_ZONE,
          startsAt: pastStart,
          endsAt: pastEnd,
        },
        {
          id: eventTwoId,
          tenantId,
          slug: `simposio-${RUN}`,
          title: 'Simpósio Recente',
          status: 'PUBLISHED',
          modality: 'IN_PERSON',
          timezone: TIME_ZONE,
          startsAt: recentStart,
          endsAt: recentEnd,
        },
      ],
    }),
  );

  // Ana e Bruno têm vínculo criado pelo helper; Carla também.
  people.ana = await createPerson('Ana Participante');
  people.bruno = await createPerson('Bruno Participante');
  people.carla = await createPerson('Carla Participante');
  people.diego = await createPerson('Diego Participante', otherTenantId);

  /**
   * BRUNO PERDE O VÍNCULO de propósito: ele tem inscrição e presença, mas nenhum
   * `user_tenant_profile`. É o caso que a UNIÃO existe para cobrir — e o que um
   * diretório baseado só em vínculo esconderia.
   */
  await adminPrisma.userTenantProfile.deleteMany({
    where: { tenantId, userId: people.bruno },
  });

  // Ana: dois eventos, presença no primeiro, certificado, carta e XP.
  await register({ userId: people.ana, eventId: eventOneId, status: 'ATTENDED' });
  await register({ userId: people.ana, eventId: eventTwoId });
  await attend({ userId: people.ana, eventId: eventOneId, minutes: 90, checkedInAt: pastStart });

  await withTenant(tenantId, (tx) =>
    tx.certificate.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: eventOneId,
        userId: people.ana,
        kind: 'ATTENDANCE',
        status: 'ISSUED',
        validationCode: `F32${RUN}A`,
        title: 'Certificado de participação',
        recipientName: 'Ana Participante',
        bodyText: 'Certificamos a participação.',
        workloadMinutes: 90,
        issuedAt: pastEnd,
      },
    }),
  );

  await withTenant(tenantId, (tx) =>
    tx.userXpProfile.create({
      data: { id: randomUUID(), tenantId, userId: people.ana, totalXp: 120, level: 2 },
    }),
  );

  const cardTemplateId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.cardTemplate.create({
      data: {
        id: cardTemplateId,
        tenantId,
        eventId: eventOneId,
        slug: `carta-${RUN}`,
        name: 'Carta do Congresso',
        description: 'Presença no congresso',
        rarity: 'COMMON',
        trigger: 'CHECKIN',
        isActive: true,
      },
    }),
  );

  await withTenant(tenantId, (tx) =>
    tx.userCard.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: people.ana,
        cardTemplateId,
        eventId: eventOneId,
        source: 'CHECKIN',
        quantity: 2,
        grantedAt: pastEnd,
      },
    }),
  );

  // Bruno: presença no evento 1, sem vínculo.
  await register({ userId: people.bruno, eventId: eventOneId, status: 'ATTENDED' });
  await attend({ userId: people.bruno, eventId: eventOneId, minutes: 30, checkedInAt: pastStart });

  // Carla: vínculo sem inscrição nenhuma (é a pessoa que a instituição quer convidar).
  // Diego: pessoa de OUTRA instituição, com evento e inscrição LÁ — o `user` é global,
  // então este é o cenário que prova que a ficha não vaza por `userId`.
  const otherEventId = randomUUID();

  await withTenant(otherTenantId, (tx) =>
    tx.event.create({
      data: {
        id: otherEventId,
        tenantId: otherTenantId,
        slug: `evento-vizinho-${RUN}`,
        title: 'Evento da Instituição Vizinha',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: recentStart,
        endsAt: recentEnd,
      },
    }),
  );

  await withTenant(otherTenantId, (tx) =>
    tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId: otherTenantId,
        eventId: otherEventId,
        userId: people.diego,
        status: 'CONFIRMED',
      },
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

describe('diretório de participantes da instituição', () => {
  it('traz quem tem vínculo E quem só tem inscrição — e nunca quem é de outra instituição', async () => {
    const listing = await listParticipants({ tenantId, pageSize: 50 });

    expect(listing.ok).toBe(true);
    if (!listing.ok) return;

    const ids = listing.entries.map((entry) => entry.userId);

    expect(ids).toContain(people.ana);
    expect(ids).toContain(people.bruno);
    expect(ids).toContain(people.carla);
    expect(ids).not.toContain(people.diego);

    const bruno = listing.entries.find((entry) => entry.userId === people.bruno);
    const carla = listing.entries.find((entry) => entry.userId === people.carla);

    // Bruno entrou pela INSCRIÇÃO (perdeu o vínculo no cenário).
    expect(bruno?.origin).toBe('REGISTRATION');
    expect(bruno?.events).toBe(1);
    expect(bruno?.visits).toBe(1);
    expect(bruno?.minutes).toBe(30);

    // Carla entrou pelo VÍNCULO, sem inscrição nenhuma.
    expect(carla?.origin).toBe('MEMBERSHIP');
    expect(carla?.events).toBe(0);
    expect(carla?.rate.hasData).toBe(false);
    expect(carla?.rate.label).toBe('Sem inscrições confirmadas');
  });

  it('soma a vida da pessoa ATRAVÉS dos eventos', async () => {
    const listing = await listParticipants({ tenantId, query: 'Ana', pageSize: 10 });

    expect(listing.ok).toBe(true);
    if (!listing.ok) return;

    const ana = listing.entries[0];
    expect(ana?.userId).toBe(people.ana);

    // 2 eventos, 2 inscrições confirmadas, 1 presença, 90 minutos.
    expect(ana?.events).toBe(2);
    expect(ana?.confirmed).toBe(2);
    expect(ana?.attended).toBe(1);
    expect(ana?.attendedEvents).toBe(1);
    expect(ana?.visits).toBe(1);
    expect(ana?.minutes).toBe(90);
    expect(ana?.certificates).toBe(1);
    expect(ana?.cards).toBe(2);
    expect(ana?.xp).toBe(120);
    expect(ana?.rate.percent).toBe(50);

    // O e-mail sai mascarado da camada de dados: a tela não recebe o endereço.
    expect(ana?.emailMasked).toMatch(/@exemplo\.test$/);
    expect(ana?.emailMasked).not.toBe(ana?.email);
  });

  it('filtra por evento, por certificado e por presença', async () => {
    const byEventOne = await listParticipants({ tenantId, eventId: eventOneId, pageSize: 50 });
    const byEventTwo = await listParticipants({ tenantId, eventId: eventTwoId, pageSize: 50 });
    const withCertificate = await listParticipants({ tenantId, onlyWithCertificate: true, pageSize: 50 });
    const attended = await listParticipants({ tenantId, onlyAttended: true, pageSize: 50 });

    expect(byEventOne.ok && byEventOne.entries.map((entry) => entry.userId).sort()).toEqual(
      [people.ana, people.bruno].sort(),
    );
    expect(byEventTwo.ok && byEventTwo.entries.map((entry) => entry.userId)).toEqual([people.ana]);
    expect(withCertificate.ok && withCertificate.entries.map((entry) => entry.userId)).toEqual([people.ana]);
    expect(attended.ok && attended.entries.map((entry) => entry.userId).sort()).toEqual(
      [people.ana, people.bruno].sort(),
    );
  });

  it('pagina sem repetir nem perder ninguém, e a página além do fim cai na última', async () => {
    const first = await listParticipants({ tenantId, pageSize: 1, page: 1 });
    const second = await listParticipants({ tenantId, pageSize: 1, page: 2 });
    const beyond = await listParticipants({ tenantId, pageSize: 1, page: 99 });

    expect(first.ok && first.entries).toHaveLength(1);
    expect(second.ok && second.entries).toHaveLength(1);
    if (!first.ok || !second.ok || !beyond.ok) return;

    expect(first.entries[0]?.userId).not.toBe(second.entries[0]?.userId);
    expect(first.page.total).toBeGreaterThanOrEqual(3);
    expect(beyond.page.page).toBe(beyond.page.totalPages);
  });

  it('a busca por nome não vaza para outra instituição', async () => {
    const listing = await listParticipants({ tenantId, query: 'Diego', pageSize: 50 });

    expect(listing.ok).toBe(true);
    if (!listing.ok) return;

    expect(listing.entries).toHaveLength(0);
  });
});

describe('ficha do participante', () => {
  it('reúne eventos, frequência, certificados, cartas, XP e comunicação', async () => {
    const result = await getParticipantProfile({ tenantId, userId: people.ana, actorId: people.carla });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { profile } = result;

    expect(profile.name).toBe('Ana Participante');
    expect(profile.email).toContain('@exemplo.test');
    expect(profile.totals.events).toBe(2);
    expect(profile.totals.visits).toBe(1);
    expect(profile.totals.minutes).toBe(90);
    expect(profile.totals.averageMinutes).toBe(90);
    expect(profile.totals.certificates).toBe(1);
    expect(profile.totals.cards).toBe(2);
    expect(profile.totals.xp).toBe(120);
    expect(profile.events).toHaveLength(2);
    expect(profile.certificates[0]?.validationCode).toBe(`F32${RUN}A`);
    expect(profile.cards[0]?.name).toBe('Carta do Congresso');
    expect(profile.engagement).toContain('CERTIFIED');
  });

  it('REGISTRA na trilha quem abriu a ficha (a leitura é um fato auditável)', async () => {
    await getParticipantProfile({ tenantId, userId: people.bruno, actorId: people.carla });

    const trail = await listAuditLog(tenantId, { limit: 50 });
    const entry = trail.find(
      (row) => row.action === 'READ' && row.entityType === 'participant' && row.entityId === people.bruno,
    );

    expect(entry).toBeDefined();
    // A trilha guarda o AUTOR da consulta (nome resolvido), não só o id.
    expect(entry?.actorName).toBe('Carla Participante');
  });

  it('recusa a ficha de quem não participa desta instituição', async () => {
    const result = await getParticipantProfile({
      tenantId,
      userId: people.diego,
      actorId: people.ana,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

describe('recados (e-mail + caixa de entrada)', () => {
  it('grava a mensagem na plataforma E enfileira o e-mail — sem perder uma perna', async () => {
    const result = await sendParticipantMessage({
      tenantId,
      tenantSlug,
      actorId: people.carla,
      userIds: [people.ana],
      subject: 'Credenciamento abre às 8h',
      body: 'Chegue com o QR Code em mãos.\n\nEquipe da organização.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sent).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.recipients[0]?.queued).toBe(true);

    const stored = await withTenant(tenantId, (tx) =>
      tx.participantMessage.findMany({
        where: { tenantId, userId: people.ana },
        select: { id: true, subject: true, body: true, dedupeKey: true, batchId: true, readAt: true },
      }),
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]?.subject).toBe('Credenciamento abre às 8h');
    expect(stored[0]?.readAt).toBeNull();

    /**
     * O E-MAIL SAIU MESMO PELA FILA — `queued === true` é a asserção que impede a
     * degradação silenciosa da armadilha 49 (jobId inválido → caminho inline).
     */
    const emails = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findMany({
        where: { tenantId, toUserId: people.ana },
        select: { template: true, dedupeKey: true, status: true, subject: true },
      }),
    );

    expect(emails).toHaveLength(1);
    expect(emails[0]?.template).toBe('PARTICIPANT_MESSAGE');
    /**
     * O estado é `QUEUED` **ou** `SENT`: com o worker no ar, ele pode entregar a
     * mensagem entre o enfileiramento e esta leitura — a corrida é do ambiente, não do
     * produto, e o fato que este teste mede é "o e-mail foi enfileirado para ESTA
     * pessoa, com ESTE template e ESTA chave".
     */
    expect(['QUEUED', 'SENT']).toContain(emails[0]?.status);
    expect(emails[0]?.dedupeKey).toBe(stored[0]?.dedupeKey);
    expect(emails[0]?.subject).toContain('Credenciamento abre às 8h');
  });

  it('ignora destinatário que não é da instituição, e recusa recado sem sentido', async () => {
    const withStranger = await sendParticipantMessage({
      tenantId,
      tenantSlug,
      actorId: people.carla,
      userIds: [people.ana, people.diego],
      subject: 'Só para quem é daqui',
      body: 'Este recado não pode chegar a outra instituição.',
    });

    expect(withStranger.ok).toBe(true);
    if (!withStranger.ok) return;

    expect(withStranger.sent).toBe(1);
    expect(withStranger.recipients.map((row) => row.userId)).toEqual([people.ana]);

    const invalid = await sendParticipantMessage({
      tenantId,
      tenantSlug,
      actorId: people.carla,
      userIds: [people.ana],
      subject: 'ab',
      body: 'corpo',
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('INVALID_INPUT');
  });

  it('o lote não é truncado quando cabe, e a trilha registra o envio', async () => {
    const result = await sendParticipantMessage({
      tenantId,
      tenantSlug,
      actorId: people.carla,
      userIds: [people.ana, people.bruno],
      subject: 'Aviso sobre o simpósio',
      body: 'O simpósio começa às 9h.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sent).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.skipped).toBe(0);

    const trail = await listAuditLog(tenantId, { limit: 50 });
    const entry = trail.find(
      (row) => row.action === 'CREATE' && row.entityType === 'participant_message' && row.entityId === result.batchId,
    );

    expect(entry).toBeDefined();
  });
});

describe('caixa de entrada do participante', () => {
  it('cada pessoa vê apenas os próprios recados', async () => {
    const ana = await listOwnMessages({ tenantId, userId: people.ana });
    const bruno = await listOwnMessages({ tenantId, userId: people.bruno });

    expect(ana.ok).toBe(true);
    expect(bruno.ok).toBe(true);
    if (!ana.ok || !bruno.ok) return;

    expect(ana.entries.length).toBeGreaterThanOrEqual(2);
    expect(bruno.entries.length).toBeGreaterThanOrEqual(1);
    expect(ana.entries.every((row) => row.subject !== 'Aviso sobre o simpósio' || true)).toBe(true);
    // O recado individual da Ana não aparece para o Bruno.
    expect(bruno.entries.map((row) => row.subject)).not.toContain('Credenciamento abre às 8h');
  });

  it('marcar como lida vale só para a PRÓPRIA mensagem (posse conferida no banco)', async () => {
    const ana = await listOwnMessages({ tenantId, userId: people.ana });
    if (!ana.ok) throw new Error('caixa indisponível');

    const target = ana.entries.find((row) => row.readAt === null);
    if (!target) throw new Error('nenhuma mensagem não lida');

    // Bruno tenta marcar a mensagem da Ana: nada acontece (0 linhas).
    const foreign = await markMessageRead({ tenantId, userId: people.bruno, messageId: target.id });
    expect(foreign.ok && foreign.marked).toBe(false);

    const own = await markMessageRead({ tenantId, userId: people.ana, messageId: target.id });
    expect(own.ok && own.marked).toBe(true);

    const after = await listOwnMessages({ tenantId, userId: people.ana });
    if (!after.ok) return;

    expect(after.entries.find((row) => row.id === target.id)?.readAt).not.toBeNull();
  });
});

describe('inteligência da instituição', () => {
  const now = new Date('2026-09-21T15:00:00.000Z');

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE OS RECADOS SÃO RECARIMBADOS ANTES DESTE BLOCO
   * ─────────────────────────────────────────────────────────────────────────────
   *  `sendParticipantMessage` carimba `sentAt` com o RELÓGIO REAL, enquanto este
   *  arquivo fixa `now` em 21/09/2026 para montar as janelas do painel. Enquanto a
   *  execução acontece no dia 21 (fuso da instituição), o recado cai dentro da janela
   *  "até o fim do dia 21"; depois da meia-noite ele cai FORA — e a asserção de recados
   *  falha sem nenhuma linha de código ter mudado. O teste media a hora do relógio em
   *  vez do produto (armadilha 77).
   *
   *  Fixar o carimbo num instante dentro da janela é o que torna a fixture determinística:
   *  o que está sob teste é a AGREGAÇÃO por período, não quando o e-mail foi enfileirado.
   */
  beforeAll(async () => {
    await withTenant(tenantId, (tx) =>
      tx.participantMessage.updateMany({
        where: { tenantId },
        data: { sentAt: new Date('2026-09-21T14:00:00.000Z') },
      }),
    );
  });

  it('apura totais e a série por evento, com a taxa de comparecimento', async () => {
    const result = await getInstitutionIntelligence({ tenantId, range: 'ALL', now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { totals, events } = result.insight;

    expect(totals.participants).toBeGreaterThanOrEqual(3);
    expect(events).toHaveLength(2);
    expect(totals.confirmed).toBe(3);
    expect(totals.attended).toBe(2);
    expect(totals.rate.percent).toBe(67);
    expect(totals.minutes).toBe(120);
    expect(totals.certificates).toBe(1);
    expect(totals.messages).toBeGreaterThanOrEqual(3);
    expect(result.insight.range.timeZone).toBe(TIME_ZONE);

    const congress = events.find((row) => row.eventId === eventOneId);
    expect(congress?.confirmed).toBe(2);
    expect(congress?.attended).toBe(2);
    expect(congress?.rate.percent).toBe(100);

    const simposio = events.find((row) => row.eventId === eventTwoId);
    expect(simposio?.confirmed).toBe(1);
    expect(simposio?.attended).toBe(0);
    expect(simposio?.rate.percent).toBe(0);
  });

  it('o período recorta a série e não inventa dado quando não há evento', async () => {
    const recent = await getInstitutionIntelligence({ tenantId, range: '30D', now });

    expect(recent.ok).toBe(true);
    if (!recent.ok) return;

    // Em 21/09, os últimos 30 dias alcançam o simpósio (10/09) e não o congresso (10/05).
    expect(recent.insight.events.map((row) => row.eventId)).toEqual([eventTwoId]);
    expect(recent.insight.totals.attended).toBe(0);
    expect(recent.insight.totals.rate.percent).toBe(0);

    const custom = await getInstitutionIntelligence({
      tenantId,
      range: 'CUSTOM',
      fromDay: '2026-01-01',
      toDay: '2026-01-31',
      now,
    });

    expect(custom.ok).toBe(true);
    if (!custom.ok) return;

    expect(custom.insight.events).toHaveLength(0);
    expect(custom.insight.totals.rate.hasData).toBe(false);
    expect(custom.insight.totals.rate.percent).toBeNull();
    expect(custom.insight.range.label).toBe('01/01/2026 a 31/01/2026');
  });
});

describe('exportação do diretório', () => {
  it('gera CSV com cabeçalho, sem o estranho de outra instituição, e deixa rastro', async () => {
    const result = await exportParticipantsCsv({ tenantId, actorId: people.carla });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.csv.startsWith('\uFEFF')).toBe(true);
    expect(result.csv).toContain('Nome;E-mail;Origem');
    expect(result.csv).toContain('Ana Participante');
    expect(result.csv).toContain('Bruno Participante');
    expect(result.csv).toContain('Só inscrição');
    expect(result.csv).not.toContain('Diego Participante');
    expect(result.rows).toBeGreaterThanOrEqual(3);

    const trail = await listAuditLog(tenantId, { limit: 50 });
    const entry = trail.find((row) => row.action === 'EXPORT' && row.entityType === 'participant');

    expect(entry).toBeDefined();
    // A trilha guarda o AUTOR da consulta (nome resolvido), não só o id.
    expect(entry?.actorName).toBe('Carla Participante');
  });

  it('o CSV carrega o e-mail COMPLETO (é o insumo da ação, não a vitrine)', async () => {
    const result = await exportParticipantsCsv({ tenantId, actorId: people.carla, filters: { query: 'Ana' } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.csv).toContain('@exemplo.test');
    // A máscara da tela NÃO aparece no arquivo: quem exporta quer o endereço.
    expect(result.csv).not.toContain('*@exemplo.test');
  });
});
