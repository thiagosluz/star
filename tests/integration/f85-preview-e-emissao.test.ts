/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A CATRACA DA IGUALDADE — o preview e a emissão concordam (FASE 85 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE É O CORAÇÃO DA FATIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela mostra uma SIMULAÇÃO. Se ela divergir da emissão, o organizador vê "2
 *  certificados" e o botão emite 1 (ou 3) — sem erro, sem log, descoberto no dia
 *  do evento. O teste compara, no MESMO evento e com o MESMO serviço:
 *
 *    • o conjunto (pessoa × tipo) que o preview marcou como elegível;
 *    • o conjunto de certificados que `requestEventCertificates` realmente criou;
 *    • e o conjunto de DESCARTES, comparando o motivo texto a texto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE COBRE AS QUATRO PORTAS DE ENTRADA E OS DOIS LADOS DO ESCOPO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    presença · palestrante · parecer · autoria aceita  →  candidatos
 *    inscrição no EVENTO sem presença em atividade      →  NÃO é candidato
 *    duas linhas de 30 min na mesma atividade de 60     →  somam 60 e são
 *                                                          ELEGÍVEIS (E92, FASE 86)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  previewEventCertificates,
  requestEventCertificates,
} from '../../src/lib/certificates/certificate-service';
import { summarizeEventPreview } from '../../src/domain/certificates/certificate-preview-rules';
import type { CertificateKind } from '../../src/domain/certificates/certificate-rules';

const RUN = randomUUID().slice(0, 8);
const KINDS: readonly CertificateKind[] = ['ATTENDANCE', 'MINI_COURSE'];

let tenantId: string;
let eventId: string;
let activityId: string;

const userIds: Record<string, string> = {};
const emails: string[] = [];

async function createUser(key: string, name: string): Promise<string> {
  const id = randomUUID();
  const email = `f85.previa.${RUN}.${key}@exemplo.test`;
  emails.push(email);

  await adminPrisma.user.create({ data: { id, name, email, emailVerified: true } });

  userIds[key] = id;

  return id;
}

/** Uma LINHA de presença — o `registrationId` é opcional no schema. */
async function createAttendanceRow(
  userId: string,
  input: { minutes: number; activity?: string | null; checkedOutAt?: Date | null },
): Promise<void> {
  const start = new Date('2026-09-17T12:00:00.000Z');
  const checkedOutAt =
    input.checkedOutAt === undefined
      ? new Date(start.getTime() + input.minutes * 60_000)
      : input.checkedOutAt;

  await withTenant(tenantId, (tx) =>
    tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: input.activity === undefined ? activityId : input.activity,
        userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: start,
        checkedOutAt,
        minutesAttended: input.minutes,
      },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  activityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f85-preview-${RUN}`,
      name: `Instituição Previa ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = new Date('2026-09-17T12:00:00.000Z');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-preview-${RUN}`,
        title: `Congresso da Prévia ${RUN}`,
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
        timezone: 'America/Bahia',
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: `minicurso-preview-${RUN}`,
        title: 'Minicurso da Prévia',
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        workloadMinutes: 60,
      },
    });
  });

  await createUser('ana', 'Ana Elegível');
  await createUser('bruno', 'Bruno Abaixo do Mínimo');
  await createUser('carla', 'Carla Palestrante');
  await createUser('diego', 'Diego Revisor');
  await createUser('elisa', 'Elisa Autora');
  await createUser('fausto', 'Fausto Só no Evento');
  await createUser('gabi', 'Gabi Duas Visitas');

  // 60 de 60 min → elegível para presença e minicurso.
  await createAttendanceRow(userIds.ana!, { minutes: 60 });

  // 10 de 60 min → abaixo dos 45 exigidos (75 % da carga).
  await createAttendanceRow(userIds.bruno!, { minutes: 10 });

  // DUAS visitas de 30 min na MESMA atividade de 60. Até a FASE 85 cada linha era
  // avaliada sozinha e as duas ficavam abaixo dos 45 exigidos; desde a FASE 86 a
  // presença é somada por pessoa × atividade (dívida E92), então Gabi tem 60 de 60.
  await createAttendanceRow(userIds.gabi!, { minutes: 30 });
  await createAttendanceRow(userIds.gabi!, { minutes: 30 });

  // Só credenciamento no evento (linha com activityId nulo): NÃO entra no escopo da
  // emissão em lote, que percorre fatos de atividade/submissão.
  await withTenant(tenantId, (tx) =>
    tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId: userIds.fausto!,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: new Date('2026-09-17T12:00:00.000Z'),
      },
    }),
  );

  await withTenant(tenantId, async (tx) => {
    // Palestrante sem presença em atividade — candidato pela palestra.
    await tx.activitySpeaker.create({
      data: {
        id: randomUUID(),
        tenantId,
        activityId,
        userId: userIds.carla!,
        workloadMinutes: 60,
      },
    });

    const trackId = randomUUID();

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-preview-${RUN}`,
        name: 'Trilha da Prévia',
      },
    });

    const submissionId = randomUUID();

    await tx.submission.create({
      data: {
        id: submissionId,
        tenantId,
        eventId,
        trackId,
        protocol: `PV${RUN.slice(0, 6).toUpperCase()}`,
        title: 'Trabalho aceito da prévia',
        abstract: 'Resumo suficientemente longo para o teste de igualdade da prévia da emissão.',
        keywords: ['prévia', 'certificados'],
        status: 'ACCEPTED',
        submittedById: userIds.elisa!,
        submittedAt: new Date('2026-09-01T12:00:00.000Z'),
        authors: {
          create: {
            id: randomUUID(),
            tenantId,
            userId: userIds.elisa!,
            authorOrder: 1,
            isCorresponding: true,
          },
        },
      },
    });

    // Parecer submetido — candidato pela revisão.
    await tx.review.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId,
        reviewerId: userIds.diego!,
        recommendation: 'ACCEPT',
        weightedScore: 90,
        scores: [],
        submittedAt: new Date('2026-09-02T12:00:00.000Z'),
      },
    });
  });
});

afterAll(async () => {
  // A catraca de fixtures da FASE 83: instituição criada é instituição apagada.
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { in: emails } } });
  await adminPrisma.$disconnect();
});

describe('preview e emissão concordam no MESMO evento', () => {
  it('a simulação não grava, o escopo é a população da emissão e a fração é elegíveis ÷ escopo', async () => {
    const preview = await previewEventCertificates({ tenantId, eventId, kinds: KINDS });

    expect(preview.ok, preview.ok ? 'ok' : preview.message).toBe(true);
    if (!preview.ok) return;

    /**
     * Seis pessoas, não sete: Fausto tem credenciamento no evento e NENHUM fato de
     * atividade/submissão. Contar inscrições (`_count.registrations`) o incluiria e
     * a tela mostraria uma população que a emissão nunca examina.
     */
    expect(preview.preview.scope).toBe(6);
    expect(preview.preview.people.map((person) => person.userId)).not.toContain(userIds.fausto);

    const summary = summarizeEventPreview({
      scope: preview.preview.scope,
      people: preview.preview.people,
    });

    /**
     * ── O NÚMERO DA FASE 86: A DÍVIDA E92 FOI PAGA ────────────────────────────
     *  A FASE 85 fixava **1 elegível / 2 certificados / 10 descartes** porque a
     *  Gabi era julgada LINHA a linha e descartada duas vezes. A partir da FASE 86
     *  a presença é somada por pessoa × atividade, então as duas visitas de 30 min
     *  na atividade de 60 valem 60 (100 % da carga): a Gabi é ELEGÍVEL e o escopo
     *  passa a **2 elegíveis / 4 certificados / 8 descartes**. O número subiu
     *  porque o documento que faltava passou a existir — não porque a regra
     *  afrouxou: os 75 % e os 30 min continuam os mesmos.
     */
    expect(summary.eligiblePeople).toBe(2);
    expect(summary.certificatesToIssue).toBe(4);
    expect(summary.eligibleRatio).toBeCloseTo(2 / 6, 10);
    expect(summary.discarded).toHaveLength(8);

    // O motivo do Bruno é o TEXTO do domínio (o veredito agregado do tipo, o mesmo
    // que `requestCertificate` devolveria como mensagem de recusa).
    const bruno = summary.discarded.find(
      (item) => item.userId === userIds.bruno && item.kind === 'ATTENDANCE',
    );
    expect(bruno?.reason).toBe('Nenhuma atividade com presença suficiente (mínimo de 75 % da carga).');

    /**
     * ── A PROVA DA MUDANÇA (consciente) ──────────────────────────────────────
     *  Gabi tem DUAS linhas de 30 min na mesma atividade de 60. Até a FASE 85 ela
     *  aparecia com DOIS descartes; agora a soma é 60, ela passa o limiar de 45 e
     *  recebe os DOIS tipos (a atividade é um minicurso).
     */
    const gabi = preview.preview.people.find((person) => person.userId === userIds.gabi);
    expect(summary.discarded.filter((item) => item.userId === userIds.gabi)).toHaveLength(0);
    expect(gabi?.verdicts.map((verdict) => `${verdict.kind}:${verdict.eligible}`).sort()).toEqual([
      'ATTENDANCE:true',
      'MINI_COURSE:true',
    ]);

    /**
     * ── A NÃO REGRESSÃO: UMA LINHA POR ATIVIDADE NÃO MUDOU ───────────────────
     *  Ana tem UMA linha de 60 min: o conjunto dela é exatamente o de antes da
     *  agregação (presença e minicurso), e ninguém mais entrou no lugar dela.
     */
    const ana = preview.preview.people.find((person) => person.userId === userIds.ana);
    expect(ana?.verdicts.map((verdict) => `${verdict.kind}:${verdict.eligible}`).sort()).toEqual([
      'ATTENDANCE:true',
      'MINI_COURSE:true',
    ]);

    // Nada foi gravado pela simulação.
    const antes = await withTenant(tenantId, (tx) =>
      tx.certificate.count({ where: { tenantId, eventId } }),
    );
    expect(antes).toBe(0);
  });

  it('os certificados criados pela emissão são EXATAMENTE os pares que o preview aprovou', async () => {
    const preview = await previewEventCertificates({ tenantId, eventId, kinds: KINDS });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const summary = summarizeEventPreview({
      scope: preview.preview.scope,
      people: preview.preview.people,
    });

    const aprovadosNoPreview = preview.preview.people
      .flatMap((person) =>
        person.verdicts
          .filter((verdict) => verdict.eligible)
          .map((verdict) => `${person.userId}:${verdict.kind}`),
      )
      .sort();

    const emitidos = await requestEventCertificates({
      tenantId,
      eventId,
      kinds: KINDS,
    });

    expect(emitidos.ok, emitidos.ok ? 'ok' : emitidos.message).toBe(true);
    if (!emitidos.ok) return;

    const criados = await withTenant(tenantId, (tx) =>
      tx.certificate.findMany({
        where: { tenantId, eventId },
        select: { userId: true, kind: true },
      }),
    );

    const criadosSet = criados.map((row) => `${row.userId}:${row.kind}`).sort();

    // Quatro: os dois da Ana (uma linha de 60) e os dois da Gabi (duas de 30 que
    // somam 60) — a E92 paga, sem documento a mais para ninguém.
    expect(criados).toHaveLength(4);
    expect(criados.filter((row) => row.userId === userIds.ana)).toHaveLength(2);
    expect(criados.filter((row) => row.userId === userIds.gabi)).toHaveLength(2);
    expect(criados.map((row) => row.kind).sort()).toEqual([
      'ATTENDANCE',
      'ATTENDANCE',
      'MINI_COURSE',
      'MINI_COURSE',
    ]);
    expect(criadosSet).toEqual(aprovadosNoPreview);

    // E a Gabi recebe o certificado de PRESENÇA (a atividade é do tipo minicurso,
    // então a conclusão do minicurso vem junto).
    expect(criados).toContainEqual({ userId: userIds.gabi, kind: 'ATTENDANCE' });

    // E o resumo da emissão diz o mesmo número: 4 pedidos, 8 descartes.
    expect(emitidos.requested).toBe(summary.certificatesToIssue);
    expect(emitidos.skipped).toBe(summary.discarded.length);
    expect(emitidos.requested + emitidos.skipped).toBe(preview.preview.people.length * KINDS.length);
  });

  it('os DESCARTES da emissão têm o mesmo motivo que o preview mostrou', async () => {
    const preview = await previewEventCertificates({ tenantId, eventId, kinds: KINDS });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const summary = summarizeEventPreview({
      scope: preview.preview.scope,
      people: preview.preview.people,
    });

    /**
     * A segunda chamada da emissão reencontra os QUATRO certificados (dois da Ana,
     * dois da Gabi) e os devolve como `existing` — os DESCARTES, porém, são
     * recalculados do zero e precisam bater texto a texto com a simulação deste
     * render.
     */
    const emitidos = await requestEventCertificates({ tenantId, eventId, kinds: KINDS });

    expect(emitidos.ok).toBe(true);
    if (!emitidos.ok) return;

    const doPreview = summary.discarded
      .map((item) => `${item.userId}:${item.kind}:${item.reason}`)
      .sort();
    const daEmissao = emitidos.discarded
      .map((item) => `${item.userId}:${item.kind}:${item.reason}`)
      .sort();

    expect(daEmissao).toEqual(doPreview);
  });
});
