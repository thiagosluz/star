/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — os fatos que faltavam e o catálogo (FASE 43)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • inscrição, certificado e sorteio creditam UMA vez, com a chave do FATO — e o
 *      teste do "cancelar e voltar" é o que prende a escolha da chave (por alvo, e
 *      não por linha): sem ele, inscrever-se em loop viraria farm de XP;
 *    • a EXCLUSÃO é lógica e não mexe no que já foi conquistado: a carta sai do
 *      catálogo, deixa de ser concedida e CONTINUA no álbum de quem a ganhou;
 *    • a carta que é prêmio de missão ou de QR de patrocinador é RECUSADA com a
 *      contagem — a promessa em vigor não pode ficar sem prêmio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  cancelRegistration,
  registerForActivity,
  registerForEvent,
} from '../../src/lib/events/registration-service';
import { confirmRegistration } from '../../src/lib/events/confirmation-service';
import {
  generateCertificate,
  requestCertificate,
} from '../../src/lib/certificates/certificate-service';
import { createRaffle, drawRaffle } from '../../src/lib/raffles/raffle-service';
import { getAlbum } from '../../src/lib/gamification/card-service';
import { grantCardForTrigger } from '../../src/lib/gamification/reward-engine';
import {
  claimMission,
  listMissions as listParticipantMissions,
} from '../../src/lib/gamification/task-service';
import {
  deleteCardTemplate,
  deleteMission,
  listCardTemplates,
  listMissions as listAdminMissions,
  saveCardTemplate,
  saveMission,
} from '../../src/lib/admin/gamification-admin-service';
import { saveSponsor, saveSponsorTier } from '../../src/lib/admin/sponsor-service';
import { saveSponsorQrCode } from '../../src/lib/sponsors/sponsor-portal-service';
import { XP_SOURCES } from '../../src/domain/gamification/xp-rules';
import type { XpSourceKind } from '../../src/domain/gamification/types';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let openEventId: string;
let finishedEventId: string;
let activityId: string;
let singleSeatActivityId: string;
let pendingActivityId: string;
let finishedActivityId: string;
let organizerId: string;
let participantA: string;

const OPEN_EVENT_SLUG = `evento-aberto-${RUN}`;
const FINISHED_EVENT_SLUG = `evento-encerrado-${RUN}`;

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f43.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

/** As linhas do livro-razão de uma origem — a prova de que o fato foi creditado. */
async function xpRows(userId: string, source: XpSourceKind) {
  return withTenant(tenantId, (tx) =>
    tx.xpTransaction.findMany({
      where: { tenantId, userId, source },
      select: { amount: true, idempotencyKey: true },
    }),
  );
}

async function totalXp(userId: string): Promise<number> {
  const profile = await withTenant(tenantId, (tx) =>
    tx.userXpProfile.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { totalXp: true },
    }),
  );

  return profile?.totalXp ?? 0;
}

/** Inscrição confirmada direto no banco, para os cenários que não são sobre inscrição. */
async function seedAttendance(input: {
  userId: string;
  activityId: string;
  minutes: number;
}): Promise<string> {
  const registrationId = randomUUID();
  const start = new Date('2026-09-17T12:00:00.000Z');

  await withTenant(tenantId, async (tx) => {
    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId,
        eventId: finishedEventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: start,
      },
    });

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: finishedEventId,
        activityId: input.activityId,
        registrationId,
        userId: input.userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: start,
        checkedOutAt: new Date(start.getTime() + input.minutes * 60_000),
        minutesAttended: input.minutes,
      },
    });
  });

  return registrationId;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  openEventId = randomUUID();
  finishedEventId = randomUUID();
  activityId = randomUUID();
  singleSeatActivityId = randomUUID();
  pendingActivityId = randomUUID();
  finishedActivityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `fatos-${RUN}`,
      name: `Instituição dos Fatos ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  const future = new Date(Date.now() + 10 * 86_400_000);
  const past = new Date('2026-09-17T12:00:00.000Z');

  await withTenant(tenantId, async (tx) => {
    await tx.event.createMany({
      data: [
        {
          id: openEventId,
          tenantId,
          slug: OPEN_EVENT_SLUG,
          title: 'Evento Aberto',
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt: future,
          endsAt: new Date(future.getTime() + 2 * 86_400_000),
          capacity: null,
          confirmedCount: 0,
        },
        {
          id: finishedEventId,
          tenantId,
          slug: FINISHED_EVENT_SLUG,
          title: 'Evento Encerrado',
          status: 'FINISHED',
          modality: 'IN_PERSON',
          timezone: 'America/Bahia',
          startsAt: past,
          endsAt: new Date(past.getTime() + 86_400_000),
          capacity: null,
          confirmedCount: 0,
        },
      ],
    });

    await tx.activity.createMany({
      data: [
        {
          id: activityId,
          tenantId,
          eventId: openEventId,
          slug: 'oficina-aberta',
          title: 'Oficina Aberta',
          type: 'WORKSHOP',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: future,
          endsAt: new Date(future.getTime() + 3 * 3_600_000),
          workloadMinutes: 180,
          capacity: 10,
          requiresRegistration: true,
        },
        {
          id: singleSeatActivityId,
          tenantId,
          eventId: openEventId,
          slug: 'vaga-unica',
          title: 'Vaga Única',
          type: 'WORKSHOP',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: future,
          endsAt: new Date(future.getTime() + 3 * 3_600_000),
          workloadMinutes: 180,
          capacity: 1,
          waitlistEnabled: true,
          requiresRegistration: true,
        },
        {
          id: pendingActivityId,
          tenantId,
          eventId: openEventId,
          slug: 'vaga-retida',
          title: 'Vaga Retida',
          type: 'WORKSHOP',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: future,
          endsAt: new Date(future.getTime() + 3 * 3_600_000),
          workloadMinutes: 180,
          capacity: 10,
          requiresRegistration: true,
          /** A vaga só vale depois que a equipe registra a confirmação (FASE 34). */
          confirmationPolicy: 'REQUIRED',
          confirmationWindowDays: 3,
          confirmationRequirements: [{ kind: 'DONATION', label: '1 kg de alimento', note: null }],
          confirmationPlace: 'Secretaria do bloco B',
        },
        {
          id: finishedActivityId,
          tenantId,
          eventId: finishedEventId,
          slug: 'oficina-encerrada',
          title: 'Oficina Encerrada',
          type: 'MINI_COURSE',
          status: 'COMPLETED',
          modality: 'IN_PERSON',
          startsAt: past,
          endsAt: new Date(past.getTime() + 4 * 3_600_000),
          workloadMinutes: 240,
          capacity: 10,
          requiresRegistration: true,
        },
      ],
    });
  });

  organizerId = await createUser('Organizadora F43');
  participantA = await createUser('Participante A F43');
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('inscrição confirmada', () => {
  it('a inscrição no EVENTO credita uma vez, e repetir não paga', async () => {
    const first = await registerForEvent({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      userId: participantA,
    });

    expect(first.ok, first.ok ? 'ok' : first.message).toBe(true);
    if (!first.ok) return;

    const rows = await xpRows(participantA, 'REGISTRATION_CONFIRMED');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(XP_SOURCES.REGISTRATION_CONFIRMED);

    /** A segunda tentativa nem cria fato novo: a inscrição já existe. */
    const again = await registerForEvent({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      userId: participantA,
    });

    expect(again.ok).toBe(false);
    expect(await xpRows(participantA, 'REGISTRATION_CONFIRMED')).toHaveLength(1);
  });

  it('a chave de idempotência é o ALVO (a vaga), e não a linha da inscrição', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE A CHAVE NÃO É A INSCRIÇÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Com a chave por LINHA, cancelar e voltar a se inscrever criaria uma linha nova e
     *  pagaria 30 XP de novo — farm trivial, sem nenhum fato novo. Com o alvo, cada vaga
     *  paga uma vez para sempre.
     *
     *  O teste prende a ESCOLHA no próprio livro-razão: a chave gravada cita a atividade
     *  (ou o evento), e não o id da inscrição.
     */
    const pessoa = await createUser('Chave por Alvo F43');

    const inscricao = await registerForActivity({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      activitySlug: 'oficina-aberta',
      userId: pessoa,
    });

    expect(inscricao.ok, inscricao.ok ? 'ok' : inscricao.message).toBe(true);
    if (!inscricao.ok) return;

    const rows = await xpRows(pessoa, 'REGISTRATION_CONFIRMED');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toContain(activityId);
    expect(rows[0]?.idempotencyKey).not.toContain(inscricao.registrationId);

    /** E no evento a chave cita o EVENTO. */
    const noEvento = await registerForEvent({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      userId: pessoa,
    });

    expect(noEvento.ok, noEvento.ok ? 'ok' : noEvento.message).toBe(true);
    if (!noEvento.ok) return;

    const rowsEvento = await xpRows(pessoa, 'REGISTRATION_CONFIRMED');
    expect(rowsEvento).toHaveLength(2);
    expect(rowsEvento.some((row) => row.idempotencyKey.includes(openEventId))).toBe(true);
  });

  it('quem sai da lista de espera recebe o crédito quando a vaga é confirmada', async () => {
    const dono = await createUser('Dono da Vaga Única F43');
    const espera = await createUser('Na Espera F43');

    const confirmada = await registerForActivity({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      activitySlug: 'vaga-unica',
      userId: dono,
    });

    expect(confirmada.ok, confirmada.ok ? 'ok' : confirmada.message).toBe(true);
    if (!confirmada.ok) return;
    expect(confirmada.status).toBe('CONFIRMED');

    const naEspera = await registerForActivity({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      activitySlug: 'vaga-unica',
      userId: espera,
    });

    expect(naEspera.ok, naEspera.ok ? 'ok' : naEspera.message).toBe(true);
    if (!naEspera.ok) return;

    /** Na espera não há vaga — e sem vaga não há crédito. */
    expect(naEspera.status).toBe('WAITLISTED');
    expect(await xpRows(espera, 'REGISTRATION_CONFIRMED')).toHaveLength(0);

    /** Ao cancelar, o próximo é promovido e SÓ ENTÃO o fato acontece para ele. */
    await cancelRegistration({
      tenantId,
      registrationId: confirmada.registrationId,
      userId: dono,
      reason: 'desisti da vaga',
    });

    const promovido = await xpRows(espera, 'REGISTRATION_CONFIRMED');
    expect(promovido).toHaveLength(1);
    expect(promovido[0]?.amount).toBe(XP_SOURCES.REGISTRATION_CONFIRMED);
  });

  it('a vaga RETIDA só credita quando o balcão confirma (FASE 34)', async () => {
    const pessoa = await createUser('Vaga Retida F43');

    const retida = await registerForActivity({
      tenantId,
      eventSlug: OPEN_EVENT_SLUG,
      activitySlug: 'vaga-retida',
      userId: pessoa,
    });

    expect(retida.ok, retida.ok ? 'ok' : retida.message).toBe(true);
    if (!retida.ok) return;

    expect(retida.status).toBe('PENDING');
    expect(await xpRows(pessoa, 'REGISTRATION_CONFIRMED')).toHaveLength(0);

    const confirmado = await confirmRegistration({
      tenantId,
      registrationId: retida.registrationId,
      actorId: organizerId,
    });

    expect(confirmado.ok, confirmado.ok ? 'ok' : confirmado.message).toBe(true);

    const rows = await xpRows(pessoa, 'REGISTRATION_CONFIRMED');
    expect(rows).toHaveLength(1);

    /** Confirmar de novo é recusado e não credita outra vez. */
    await confirmRegistration({ tenantId, registrationId: retida.registrationId, actorId: organizerId });
    expect(await xpRows(pessoa, 'REGISTRATION_CONFIRMED')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('certificado emitido', () => {
  it('credita no documento gerado — e gerar de novo não credita outra vez', async () => {
    const pessoa = await createUser('Certificada F43');
    await seedAttendance({ userId: pessoa, activityId: finishedActivityId, minutes: 240 });

    const requested = await requestCertificate({
      tenantId,
      eventId: finishedEventId,
      userId: pessoa,
      kind: 'PARTICIPATION',
    });

    expect(requested.ok, requested.ok ? 'ok' : requested.message).toBe(true);
    if (!requested.ok) return;

    /** O fato é o DOCUMENTO existir: antes da geração, nada foi creditado. */
    expect(await xpRows(pessoa, 'CERTIFICATE_ISSUED')).toHaveLength(0);

    const generated = await generateCertificate({ tenantId, certificateId: requested.certificateId });
    expect(generated.ok, generated.ok ? 'ok' : generated.message).toBe(true);

    const rows = await xpRows(pessoa, 'CERTIFICATE_ISSUED');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(XP_SOURCES.CERTIFICATE_ISSUED);

    await generateCertificate({ tenantId, certificateId: requested.certificateId });
    expect(await xpRows(pessoa, 'CERTIFICATE_ISSUED')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sorteio ganho', () => {
  it('o ganhador recebe o fato (0 XP) e a carta do gatilho; o suplente não', async () => {
    const card = await saveCardTemplate({
      tenantId,
      actorId: organizerId,
      slug: `sorteado-${RUN}`,
      name: 'Sorteado',
      rarity: 'RARE',
      trigger: 'RAFFLE_WON',
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 0,
      isActive: true,
      isSecret: false,
    });

    expect(card.ok, card.ok ? 'ok' : card.message).toBe(true);

    const ganhador = await createUser('Ganhador F43');
    const suplente = await createUser('Suplente F43');

    await seedAttendance({ userId: ganhador, activityId: finishedActivityId, minutes: 240 });
    await seedAttendance({ userId: suplente, activityId: finishedActivityId, minutes: 240 });

    const raffle = await createRaffle({
      tenantId,
      eventId: finishedEventId,
      actorId: organizerId,
      title: `Sorteio F43 ${RUN}`,
      scope: 'ACTIVITY',
      activityId: finishedActivityId,
      minAttendanceMinutes: 120,
      winnersCount: 1,
      allowPriorEventWinners: true,
    });

    expect(raffle.ok, raffle.ok ? 'ok' : raffle.message).toBe(true);
    if (!raffle.ok) return;

    const drawn = await drawRaffle({
      tenantId,
      raffleId: raffle.raffleId,
      actorId: organizerId,
      randomInt: () => 0,
    });

    expect(drawn.ok, drawn.ok ? 'ok' : drawn.message).toBe(true);
    if (!drawn.ok) return;

    const winnerId = drawn.winners[0]?.userId;
    expect(winnerId).toBeTruthy();
    if (!winnerId) return;

    /**
     * A apuração escolhe entre TODOS os presentes da atividade (o cenário do certificado
     * deixou gente ali), então o teste pergunta ao resultado quem ganhou — e não supõe.
     */
    const rows = await xpRows(winnerId, 'RAFFLE_WON');
    expect(rows).toHaveLength(1);
    /** 0 XP de propósito: o prêmio é a recompensa, e pontos por sorte premiariam o acaso. */
    expect(rows[0]?.amount).toBe(0);

    for (const outro of [ganhador, suplente].filter((id) => id !== winnerId)) {
      expect(await xpRows(outro, 'RAFFLE_WON')).toHaveLength(0);
    }

    /** E a carta de "sorteado" saiu para o ganhador. */
    const album = await getAlbum(tenantId, winnerId);
    expect(album.ok, album.ok ? 'ok' : album.message).toBe(true);
    if (album.ok) {
      expect(album.cards.some((entry) => entry.name === 'Sorteado' && entry.owned)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('catálogo: editar e excluir', () => {
  it('editar a carta mantém o ID e o que a tela mostra', async () => {
    const created = await saveCardTemplate({
      tenantId,
      actorId: organizerId,
      slug: `editavel-${RUN}`,
      name: 'Nome Antigo',
      rarity: 'COMMON',
      trigger: 'CHECKIN',
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 0,
      isActive: true,
      isSecret: false,
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const edited = await saveCardTemplate({
      tenantId,
      actorId: organizerId,
      cardTemplateId: created.cardTemplateId,
      slug: `editavel-${RUN}`,
      name: 'Nome Novo',
      rarity: 'EPIC',
      trigger: 'CERTIFICATE_ISSUED',
      levelRequired: 2,
      dropWeight: 50,
      maxSupply: 10,
      isActive: true,
      isSecret: false,
    });

    expect(edited.ok, edited.ok ? 'ok' : edited.message).toBe(true);
    if (!edited.ok) {
      return;
    }

    expect(edited.created).toBe(false);
    expect(edited.cardTemplateId).toBe(created.cardTemplateId);

    const list = await listCardTemplates(tenantId);
    const row = list.find((card) => card.id === created.cardTemplateId);

    expect(row?.name).toBe('Nome Novo');
    expect(row?.rarity).toBe('EPIC');
    expect(row?.trigger).toBe('CERTIFICATE_ISSUED');
    expect(row?.maxSupply).toBe(10);

    await deleteCardTemplate({
      tenantId,
      actorId: organizerId,
      cardTemplateId: created.cardTemplateId,
    });
  });

  it('excluir a missão a tira das DUAS listas e preserva progresso e XP', async () => {
    const missao = await saveMission({
      tenantId,
      actorId: organizerId,
      slug: `missao-excluivel-${RUN}`,
      name: 'Missão Excluível',
      kind: 'ONE_OFF',
      trigger: 'CHECKIN',
      target: { count: 1 },
      xpReward: 100,
      rewardCardTemplateId: null,
      repeatEveryHours: 0,
      isActive: true,
      isVisible: true,
      displayOrder: 0,
    });

    expect(missao.ok, missao.ok ? 'ok' : missao.message).toBe(true);
    if (!missao.ok) return;

    /** A missão acima é de CHECKIN; usar uma de REGISTRATION_CONFIRMED para progredir. */
    const missaoInscricao = await saveMission({
      tenantId,
      actorId: organizerId,
      slug: `missao-inscricao-${RUN}`,
      name: 'Missão de Inscrição',
      kind: 'ONE_OFF',
      trigger: 'REGISTRATION_CONFIRMED',
      target: { count: 1 },
      xpReward: 60,
      rewardCardTemplateId: null,
      repeatEveryHours: 0,
      isActive: true,
      isVisible: true,
      displayOrder: 0,
    });

    expect(missaoInscricao.ok, missaoInscricao.ok ? 'ok' : missaoInscricao.message).toBe(true);
    if (!missaoInscricao.ok) return;

    const outra = await createUser('Outra Inscrita F43');
    await registerForEvent({ tenantId, eventSlug: OPEN_EVENT_SLUG, userId: outra });

    const progresso = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.findMany({
        where: { tenantId, taskDefinitionId: missaoInscricao.taskDefinitionId },
        select: { status: true },
      }),
    );

    expect(progresso.length).toBeGreaterThan(0);
    expect(progresso[0]?.status).toBe('COMPLETED');

    /** Resgatar credita o XP da missão — e isso NÃO é estornado pela exclusão. */
    const resgate = await claimMission({
      tenantId,
      userId: outra,
      taskDefinitionId: missaoInscricao.taskDefinitionId,
    });

    expect(resgate.ok, resgate.ok ? 'ok' : resgate.message).toBe(true);
    const xpAntes = await totalXp(outra);
    expect(xpAntes).toBeGreaterThan(0);

    const excluida = await deleteMission({
      tenantId,
      actorId: organizerId,
      taskDefinitionId: missaoInscricao.taskDefinitionId,
    });

    expect(excluida.ok, excluida.ok ? 'ok' : excluida.message).toBe(true);
    if (!excluida.ok) return;
    expect(excluida.completions).toBeGreaterThan(0);
    expect(excluida.claims).toBe(1);

    const admin = await listAdminMissions(tenantId);
    expect(admin.some((mission) => mission.id === missaoInscricao.taskDefinitionId)).toBe(false);

    const participante = await listParticipantMissions(tenantId, outra);
    if (participante.ok) {
      expect(participante.missions.some((mission) => mission.slug === `missao-inscricao-${RUN}`)).toBe(
        false,
      );
    }

    /** O histórico fica, e o XP resgatado não é tocado. */
    const progressoDepois = await withTenant(tenantId, (tx) =>
      tx.userTaskProgress.count({
        where: { tenantId, taskDefinitionId: missaoInscricao.taskDefinitionId },
      }),
    );

    expect(progressoDepois).toBeGreaterThan(0);
    expect(await totalXp(outra)).toBe(xpAntes);
  });

  it('excluir a carta a tira do catálogo, para de concedê-la, e o álbum de quem ganhou não muda', async () => {
    const carta = await saveCardTemplate({
      tenantId,
      actorId: organizerId,
      slug: `retiravel-${RUN}`,
      name: 'Carta Retirável',
      rarity: 'COMMON',
      trigger: 'CHECKIN',
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 0,
      isActive: true,
      isSecret: false,
    });

    expect(carta.ok, carta.ok ? 'ok' : carta.message).toBe(true);
    if (!carta.ok) return;

    const dono = await createUser('Ganhou a Carta Retirável F43');

    const concedida = await grantCardForTrigger({
      tenantId,
      userId: dono,
      trigger: 'CHECKIN',
      templateId: carta.cardTemplateId,
    });

    expect(concedida.ok && concedida.cards.length).toBe(1);

    const removida = await deleteCardTemplate({
      tenantId,
      actorId: organizerId,
      cardTemplateId: carta.cardTemplateId,
    });

    expect(removida.ok, removida.ok ? 'ok' : removida.message).toBe(true);

    /** Sai do catálogo da organização... */
    const list = await listCardTemplates(tenantId);
    expect(list.some((card) => card.id === carta.cardTemplateId)).toBe(false);

    /** ...e não é mais concedida. */
    const outra = await createUser('Não recebe carta excluída F43');
    const depois = await grantCardForTrigger({
      tenantId,
      userId: outra,
      trigger: 'CHECKIN',
    });

    expect(depois.ok).toBe(true);
    if (depois.ok) {
      expect(depois.cards.some((entry) => entry.templateId === carta.cardTemplateId)).toBe(false);
    }

    /** ...mas quem JÁ ganhou continua com ela no álbum: a conquista é um fato. */
    const album = await getAlbum(tenantId, dono);
    expect(album.ok, album.ok ? 'ok' : album.message).toBe(true);
    if (album.ok) {
      const entry = album.cards.find((card) => card.name === 'Carta Retirável');
      expect(entry?.owned).toBe(true);
    }
  });

  it('a carta que é PRÊMIO de missão é recusada, com a contagem', async () => {
    const carta = await saveCardTemplate({
      tenantId,
      actorId: organizerId,
      slug: `premio-${RUN}`,
      name: 'Carta Prêmio',
      rarity: 'RARE',
      trigger: 'MANUAL_GRANT',
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 0,
      isActive: true,
      isSecret: false,
    });

    expect(carta.ok, carta.ok ? 'ok' : carta.message).toBe(true);
    if (!carta.ok) return;

    const missao = await saveMission({
      tenantId,
      actorId: organizerId,
      slug: `missao-premiada-${RUN}`,
      name: 'Missão Premiada',
      kind: 'ONE_OFF',
      trigger: 'CHECKIN',
      target: { count: 1 },
      xpReward: 10,
      rewardCardTemplateId: carta.cardTemplateId,
      repeatEveryHours: 0,
      isActive: true,
      isVisible: true,
      displayOrder: 0,
    });

    expect(missao.ok, missao.ok ? 'ok' : missao.message).toBe(true);
    if (!missao.ok) return;

    const recusada = await deleteCardTemplate({
      tenantId,
      actorId: organizerId,
      cardTemplateId: carta.cardTemplateId,
    });

    expect(recusada.ok).toBe(false);
    if (!recusada.ok) {
      expect(recusada.code).toBe('CARD_IN_USE');
      expect(recusada.message).toContain('missão');
    }

    /** Tirar o prêmio da missão libera a exclusão. */
    await saveMission({
      tenantId,
      actorId: organizerId,
      taskDefinitionId: missao.taskDefinitionId,
      slug: `missao-premiada-${RUN}`,
      name: 'Missão Premiada',
      kind: 'ONE_OFF',
      trigger: 'CHECKIN',
      target: { count: 1 },
      xpReward: 10,
      rewardCardTemplateId: null,
      repeatEveryHours: 0,
      isActive: true,
      isVisible: true,
      displayOrder: 0,
    });

    const liberada = await deleteCardTemplate({
      tenantId,
      actorId: organizerId,
      cardTemplateId: carta.cardTemplateId,
    });

    expect(liberada.ok, liberada.ok ? 'ok' : liberada.message).toBe(true);
  });

  it('a carta que é prêmio de QR de patrocinador é recusada', async () => {
    const tier = await saveSponsorTier({
      tenantId,
      eventId: openEventId,
      actorId: organizerId,
      key: 'GOLD',
      name: 'Ouro F43',
      description: null,
      color: null,
      logoScale: 'MEDIUM',
      rank: 10,
      priceCents: 0,
      currency: 'BRL',
      maxSponsors: 0,
      benefits: [],
    });

    expect(tier.ok, tier.ok ? 'ok' : tier.message).toBe(true);
    if (!tier.ok) return;

    const patrocinador = await saveSponsor({
      tenantId,
      eventId: openEventId,
      actorId: organizerId,
      name: `Patrocinador F43 ${RUN}`,
      description: null,
      websiteUrl: null,
      logoUrl: null,
      tierId: tier.tierId,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      taxId: null,
      contractValueCents: null,
      contractStart: null,
      contractEnd: null,
      displayOrder: 0,
      isActive: true,
    });

    expect(patrocinador.ok, patrocinador.ok ? 'ok' : patrocinador.message).toBe(true);
    if (!patrocinador.ok) return;

    const carta = await saveCardTemplate({
      tenantId,
      actorId: organizerId,
      slug: `carta-qr-${RUN}`,
      name: 'Carta do Estande',
      rarity: 'RARE',
      trigger: 'SPONSOR_QR',
      levelRequired: 1,
      dropWeight: 100,
      maxSupply: 0,
      isActive: true,
      isSecret: false,
    });

    expect(carta.ok, carta.ok ? 'ok' : carta.message).toBe(true);
    if (!carta.ok) return;

    const qr = await saveSponsorQrCode({
      tenantId,
      actorId: organizerId,
      sponsorId: patrocinador.sponsorId,
      eventId: openEventId,
      label: 'Estande F43',
      xpAmount: 50,
      cardTemplateId: carta.cardTemplateId,
      consentDays: 90,
    });

    expect(qr.ok, qr.ok ? 'ok' : qr.message).toBe(true);

    const recusada = await deleteCardTemplate({
      tenantId,
      actorId: organizerId,
      cardTemplateId: carta.cardTemplateId,
    });

    expect(recusada.ok).toBe(false);
    if (!recusada.ok) {
      expect(recusada.code).toBe('CARD_IN_USE');
      expect(recusada.message).toContain('QR');
    }
  });
});
