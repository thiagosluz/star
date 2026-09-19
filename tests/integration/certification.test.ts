/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — certificação
 *
 *  Roda contra banco e storage REAIS. Cobre o que só a integração prova:
 *    • a policy de validação pública (leitura SEM contexto de tenant);
 *    • a assinatura verificada a partir do que está gravado no banco;
 *    • a detecção de adulteração do conteúdo;
 *    • o upload efetivo do PDF no bucket.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { BUCKETS, inspectObject } from '../../src/lib/storage/s3-client';
import {
  generateCertificate,
  getCertificateDownloadUrl,
  getPublicCertificate,
  getPublicCertificateDownloadUrl,
  issueCertificate,
  listCertificates,
  requestCertificate,
  requestEventCertificates,
  revokeCertificate,
} from '../../src/lib/certificates/certificate-service';
import { isValidValidationCodeFormat } from '../../src/domain/certificates/certificate-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let miniCourseId: string;
let lectureId: string;

let participantId: string;
let speakerId: string;
let reviewerId: string;
let authorId: string;
let outsiderId: string;

async function createUser(name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name, email: `cert.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });
  return id;
}

/** Cria uma presença completa (entrada e saída) para uma atividade. */
async function createAttendance(input: {
  tenantId: string;
  userId: string;
  activityId: string;
  minutes: number;
}): Promise<void> {
  const registrationId = randomUUID();
  const start = new Date('2026-09-17T12:00:00.000Z');

  await withTenant(input.tenantId, async (tx) => {
    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId: input.tenantId,
        eventId,
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
        tenantId: input.tenantId,
        eventId,
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
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  const startsAt = new Date('2026-09-17T12:00:00.000Z');

  for (const [id, slug, name] of [
    [tenantId, `cert-${RUN}`, `Instituição Certificadora ${RUN}`],
    [otherTenantId, `cert-outro-${RUN}`, `Outra Instituição ${RUN}`],
  ] as const) {
    await adminPrisma.tenant.create({
      data: { id, slug, name, status: 'ACTIVE', plan: 'FREE', timezone: 'America/Bahia' },
    });
  }

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-cert',
        title: 'Congresso de Certificação 2026',
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    miniCourseId = randomUUID();
    lectureId = randomUUID();

    await tx.activity.createMany({
      data: [
        {
          id: miniCourseId,
          tenantId,
          eventId,
          slug: 'minicurso-cert',
          title: 'Minicurso de Certificação',
          type: 'MINI_COURSE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          workloadMinutes: 240,
        },
        {
          id: lectureId,
          tenantId,
          eventId,
          slug: 'palestra-cert',
          title: 'Palestra de Certificação',
          type: 'LECTURE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          workloadMinutes: 60,
        },
      ],
    });
  });

  participantId = await createUser('Participante Certificado');
  speakerId = await createUser('Palestrante Certificado');
  reviewerId = await createUser('Revisor Certificado');
  authorId = await createUser('Autora Certificada');
  outsiderId = await createUser('Sem Fatos');

  // Participante: minicurso completo (240 min, teto respeitado) + palestra.
  await createAttendance({ tenantId, userId: participantId, activityId: miniCourseId, minutes: 300 });
  await createAttendance({ tenantId, userId: participantId, activityId: lectureId, minutes: 55 });

  // Revisor com dois pareceres concluídos e autora com trabalho aceito.
  await withTenant(tenantId, async (tx) => {
    const trackId = randomUUID();

    await tx.track.create({
      data: { id: trackId, tenantId, eventId, slug: 'trilha-cert', name: 'Trilha de Certificação' },
    });

    const submissionId = randomUUID();

    await tx.submission.create({
      data: {
        id: submissionId,
        tenantId,
        eventId,
        trackId,
        protocol: `CRT${RUN.slice(0, 4).toUpperCase()}`,
        title: 'Trabalho certificado sobre certificação',
        abstract: 'Resumo suficientemente longo para os testes de certificação automática de eventos.',
        keywords: ['certificação', 'eventos'],
        status: 'ACCEPTED',
        submittedById: authorId,
        submittedAt: new Date(),
        authors: {
          create: {
            id: randomUUID(),
            tenantId,
            userId: authorId,
            authorOrder: 1,
            isCorresponding: true,
          },
        },
      },
    });

    const assignmentId = randomUUID();
    await tx.reviewAssignment.create({
      data: {
        id: assignmentId,
        tenantId,
        submissionId,
        reviewerId,
        // `SUBMITTED` é o estado de uma atribuição com parecer entregue.
        status: 'SUBMITTED',
        isBlind: true,
      },
    });

    await tx.review.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId,
        assignmentId,
        reviewerId,
        recommendation: 'ACCEPT',
        weightedScore: 90,
        scores: [],
        submittedAt: new Date(),
      },
    });

    // Palestrante da palestra, com credenciamento no evento (FASE 25: o certificado de
    // palestrante exige presença registrada no balcão, além do vínculo com a atividade).
    await tx.activitySpeaker.create({
      data: {
        id: randomUUID(),
        tenantId,
        activityId: lectureId,
        userId: speakerId,
        workloadMinutes: 90,
      },
    });

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId: speakerId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: new Date('2026-09-17T12:00:00.000Z'),
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('solicitação de certificado', () => {
  it('cria o documento com código, hash e assinatura', async () => {
    const result = await requestCertificate({
      tenantId,
      eventId,
      userId: participantId,
      kind: 'MINI_COURSE',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.existing).toBe(false);
    expect(result.status).toBe('QUEUED');
    expect(isValidValidationCodeFormat(result.validationCode)).toBe(true);

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: result.certificateId },
        select: {
          contentHash: true,
          signature: true,
          signatureKeyId: true,
          signatureAlg: true,
          workloadMinutes: true,
          recipientName: true,
          workloadBreakdown: true,
        },
      }),
    );

    expect(row.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.signature).toBeTruthy();
    expect(row.signatureAlg).toBe('HMAC-SHA256');
    // 300 minutos medidos em um minicurso de 240 → 240 (teto da carga declarada).
    expect(row.workloadMinutes).toBe(240);
    expect(row.recipientName).toBe('Participante Certificado');
    expect(Array.isArray(row.workloadBreakdown)).toBe(true);
  });

  it('é IDEMPOTENTE: pedir de novo devolve o mesmo documento e o mesmo código', async () => {
    const first = await requestCertificate({
      tenantId,
      eventId,
      userId: participantId,
      kind: 'ATTENDANCE',
    });
    const second = await requestCertificate({
      tenantId,
      eventId,
      userId: participantId,
      kind: 'ATTENDANCE',
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.existing).toBe(true);
    expect(second.certificateId).toBe(first.certificateId);
    expect(second.validationCode).toBe(first.validationCode);
  });

  it('RECUSA quem não tem fato suficiente, explicando o motivo', async () => {
    const result = await requestCertificate({
      tenantId,
      eventId,
      userId: outsiderId,
      kind: 'MINI_COURSE',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_ELIGIBLE');
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it('recusa MERIT automaticamente (é decisão do comitê)', async () => {
    const result = await requestCertificate({
      tenantId,
      eventId,
      userId: participantId,
      kind: 'MERIT',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_ELIGIBLE');
  });

  it('bloqueia a emissão quando a assinatura não está configurada', async () => {
    const original = process.env.CERTIFICATE_HMAC_SECRET;
    delete process.env.CERTIFICATE_HMAC_SECRET;

    try {
      const result = await requestCertificate({
        tenantId,
        eventId,
        userId: speakerId,
        kind: 'SPEAKER',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('SIGNING_NOT_CONFIGURED');
    } finally {
      process.env.CERTIFICATE_HMAC_SECRET = original;
    }
  });

  it('emite para palestrante com a carga declarada', async () => {
    const result = await requestCertificate({
      tenantId,
      eventId,
      userId: speakerId,
      kind: 'SPEAKER',
      /**
       * `now` DEPOIS do fim do evento (FASE 25).
       *
       * O certificado de palestrante declara fato consumado: só é emitido com o
       * evento encerrado e o credenciamento registrado. O fixture marca o evento em
       * setembro de 2026, então a emissão é avaliada em outubro — como aconteceria
       * de verdade, no dia seguinte ao encerramento.
       */
      now: new Date('2026-10-01T12:00:00.000Z'),
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: result.certificateId },
        select: { workloadMinutes: true },
      }),
    );

    expect(row.workloadMinutes).toBe(90);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS DUAS RECUSAS NOVAS DA FASE 25, CONTRA O BANCO REAL
   * ─────────────────────────────────────────────────────────────────────────────
   *  Cada uma isola UM fato: o mesmo palestrante, o mesmo evento, o mesmo vínculo —
   *  mudando só o relógio (evento em andamento) ou o credenciamento (ausente).
   */
  it('recusa o certificado de palestrante antes do término do evento', async () => {
    /**
     * Palestrante PRÓPRIO para este cenário: o certificado é idempotente pela chave
     * natural, e reusar o `speakerId` faria a chamada devolver o documento já emitido
     * acima — o teste passaria (ou falharia) sem nunca avaliar a regra do término.
     */
    const cedoId = await createUser('Palestrante Cedo');

    await withTenant(tenantId, async (tx) => {
      await tx.activitySpeaker.create({
        data: {
          id: randomUUID(),
          tenantId,
          activityId: lectureId,
          userId: cedoId,
          workloadMinutes: 90,
        },
      });

      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: null,
          userId: cedoId,
          status: 'ATTENDED',
          consentData: true,
          checkedInAt: new Date('2026-09-17T12:00:00.000Z'),
        },
      });
    });

    const result = await requestCertificate({
      tenantId,
      eventId,
      userId: cedoId,
      kind: 'SPEAKER',
      now: new Date('2026-09-18T12:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_ELIGIBLE');
      expect(result.message).toMatch(/após o término/i);
    }
  });

  it('recusa o certificado de palestrante sem credenciamento no evento', async () => {
    const semCredenciamentoId = await createUser('Palestrante Sem Credencial');

    await withTenant(tenantId, async (tx) => {
      await tx.activitySpeaker.create({
        data: {
          id: randomUUID(),
          tenantId,
          activityId: miniCourseId,
          userId: semCredenciamentoId,
          workloadMinutes: 240,
        },
      });
    });

    const result = await requestCertificate({
      tenantId,
      eventId,
      userId: semCredenciamentoId,
      kind: 'SPEAKER',
      now: new Date('2026-10-01T12:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_ELIGIBLE');
      expect(result.message).toMatch(/credenciamento/i);
    }
  });

  it('emite para revisor e para autora', async () => {
    const reviewer = await requestCertificate({
      tenantId,
      eventId,
      userId: reviewerId,
      kind: 'REVIEWER',
    });
    const author = await requestCertificate({
      tenantId,
      eventId,
      userId: authorId,
      kind: 'AUTHOR',
    });

    expect(reviewer.ok && author.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('geração do arquivo', () => {
  it('renderiza, envia ao storage e marca como emitido', async () => {
    const requested = await requestCertificate({
      tenantId,
      eventId,
      userId: authorId,
      kind: 'AUTHOR',
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    const generated = await generateCertificate({ tenantId, certificateId: requested.certificateId });

    expect(generated.ok, generated.ok ? 'ok' : generated.message).toBe(true);
    if (!generated.ok) return;

    expect(generated.status).toBe('ISSUED');
    expect(generated.sizeBytes).toBeGreaterThan(1000);

    // O objeto existe DE VERDADE no bucket, com o mesmo hash do conteúdo.
    const stored = await inspectObject(generated.bucket, generated.storageKey);
    expect(stored.exists).toBe(true);
    expect(stored.sizeBytes).toBe(generated.sizeBytes);

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: requested.certificateId },
        select: { status: true, issuedAt: true, attempts: true, contentHash: true, failureReason: true },
      }),
    );

    expect(row.status).toBe('ISSUED');
    expect(row.issuedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.failureReason).toBeNull();
    expect(row.contentHash).toBe(generated.contentHash);
  });

  it('gerar duas vezes produz o MESMO hash (documento reprodutível)', async () => {
    const requested = await requestCertificate({
      tenantId,
      eventId,
      userId: participantId,
      kind: 'PARTICIPATION',
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    const first = await generateCertificate({ tenantId, certificateId: requested.certificateId });
    const second = await generateCertificate({ tenantId, certificateId: requested.certificateId });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.contentHash).toBe(first.contentHash);
  });

  it('recusa gerar certificado inexistente', async () => {
    const result = await generateCertificate({ tenantId, certificateId: randomUUID() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validação pública', () => {
  it('valida um certificado emitido SEM contexto de tenant', async () => {
    const issued = await issueCertificate({
      tenantId,
      eventId,
      userId: reviewerId,
      kind: 'REVIEWER',
    });

    expect(issued.ok, issued.ok ? 'ok' : issued.message).toBe(true);
    if (!issued.ok) return;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O WORKER, AQUI, SOMOS NÓS (corrigido na FASE 15)
     * ─────────────────────────────────────────────────────────────────────────────
     *  `issueCertificate` ENFILEIRA a geração e devolve `generated: false` — o
     *  arquivo sai no worker, que não roda numa suíte de integração. Este trecho
     *  faz o papel dele.
     *
     *  Antes da FASE 15 este `if` não existia porque a fila nunca enfileirava de
     *  verdade: o `jobId` tinha `:`, o BullMQ recusava o job e a geração caía no
     *  caminho inline SEMPRE — o teste passava sem perceber. Com a fila funcionando,
     *  a geração explícita é necessária (e o E2E, que roda com o worker no ar,
     *  continua exercitando o caminho real).
     */
    if (!issued.generated) {
      const generated = await generateCertificate({
        tenantId,
        certificateId: issued.certificateId,
      });

      expect(generated.ok, generated.ok ? 'ok' : generated.message).toBe(true);
      if (!generated.ok) return;
    }

    // Nenhuma informação de instituição é passada: só o código.
    const result = await getPublicCertificate(issued.validationCode);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).toBe('VALID');
    expect(result.verdict.isUsable).toBe(true);
    expect(result.certificate?.recipientName).toBe('Revisor Certificado');
    expect(result.certificate?.signatureValid).toBe(true);
    expect(result.certificate?.tenantName).toContain('Certificadora');
    expect(result.certificate?.eventTitle).toContain('Certificação');
  });

  it('aceita o código em caixa baixa e com espaços', async () => {
    const list = await listCertificates({ tenantId, userId: reviewerId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const code = list.certificates[0]!.validationCode;
    const result = await getPublicCertificate(`  ${code.toLowerCase()}  `);

    expect(result.ok && result.verdict.status).toBe('VALID');
  });

  it('código inexistente é NOT_FOUND (e não erro)', async () => {
    const result = await getPublicCertificate('CERT-22222222');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).toBe('NOT_FOUND');
    expect(result.certificate).toBeNull();
  });

  it('código malformado é recusado sem consultar o banco', async () => {
    const result = await getPublicCertificate('CERT-ABC');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).toBe('NOT_FOUND');
    expect(result.verdict.message).toMatch(/formato inválido/i);
  });

  it('DETECTA adulteração do conteúdo gravado', async () => {
    const requested = await requestCertificate({
      tenantId,
      eventId,
      userId: participantId,
      kind: 'MINI_COURSE',
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    // Adulteração direta no banco: aumentar a carga horária do documento.
    await withTenant(tenantId, (tx) =>
      tx.certificate.update({
        where: { id: requested.certificateId },
        data: { workloadMinutes: 9999 },
      }),
    );

    const result = await getPublicCertificate(requested.validationCode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // O hash do conteúdo não fecha mais e a assinatura deixou de conferir.
    expect(result.certificate?.signatureValid).toBe(false);

    // Restaura para não afetar os demais testes.
    await withTenant(tenantId, (tx) =>
      tx.certificate.update({
        where: { id: requested.certificateId },
        data: { workloadMinutes: 240 },
      }),
    );
  });

  it('registra o acesso: o contador de validações cresce', async () => {
    const list = await listCertificates({ tenantId, userId: authorId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const code = list.certificates[0]!.validationCode;

    const before = await withTenant(tenantId, (tx) =>
      tx.certificate.findFirstOrThrow({
        where: { validationCode: code },
        select: { validationCount: true },
      }),
    );

    await getPublicCertificate(code);

    const after = await withTenant(tenantId, (tx) =>
      tx.certificate.findFirstOrThrow({
        where: { validationCode: code },
        select: { validationCount: true, lastValidatedAt: true },
      }),
    );

    expect(after.validationCount).toBe(before.validationCount + 1);
    expect(after.lastValidatedAt).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('revogação', () => {
  it('marca como revogado, explica o motivo e bloqueia o download', async () => {
    const requested = await requestCertificate({
      tenantId,
      eventId,
      userId: authorId,
      kind: 'AUTHOR',
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    await generateCertificate({ tenantId, certificateId: requested.certificateId });

    const revoked = await revokeCertificate({
      tenantId,
      certificateId: requested.certificateId,
      reason: 'Presença não comprovada em auditoria interna.',
    });
    expect(revoked.ok).toBe(true);

    const validation = await getPublicCertificate(requested.validationCode);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(validation.verdict.status).toBe('REVOKED');
    expect(validation.verdict.isUsable).toBe(false);
    expect(validation.verdict.message).toContain('Presença não comprovada');

    const download = await getPublicCertificateDownloadUrl(requested.validationCode);
    expect(download.ok).toBe(false);
  });

  it('recusa revogar certificado inexistente', async () => {
    const result = await revokeCertificate({
      tenantId,
      certificateId: randomUUID(),
      reason: 'Motivo qualquer de teste',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('download', () => {
  it('gera URL assinada para o dono e recusa para terceiros', async () => {
    const list = await listCertificates({ tenantId, userId: participantId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const issued = list.certificates.find((certificate) => certificate.status === 'ISSUED' && certificate.hasFile);
    expect(issued).toBeDefined();
    if (!issued) return;

    const mine = await getCertificateDownloadUrl({
      tenantId,
      certificateId: issued.id,
      userId: participantId,
    });
    expect(mine.ok).toBe(true);
    if (mine.ok) {
      expect(mine.url).toContain(BUCKETS.certificates());
      expect(mine.fileName).toMatch(/\.pdf$/);
    }

    const other = await getCertificateDownloadUrl({
      tenantId,
      certificateId: issued.id,
      userId: outsiderId,
    });
    expect(other.ok).toBe(false);
  });

  it('o download público funciona pelo código', async () => {
    const list = await listCertificates({ tenantId, userId: participantId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const issued = list.certificates.find((certificate) => certificate.status === 'ISSUED' && certificate.hasFile);
    if (!issued) return;

    const result = await getPublicCertificateDownloadUrl(issued.validationCode);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain(BUCKETS.certificates());
  });

  it('avisa quando o arquivo ainda não foi gerado', async () => {
    /**
     * Um certificado SOLICITADO mas não gerado: existe, tem código e assinatura,
     * e o arquivo ainda não está no bucket. O download precisa dizer "aguarde" em
     * vez de devolver um erro genérico — e nunca um PDF inexistente.
     */
    const pendingUserId = await createUser('Aguardando Arquivo');
    await createAttendance({ tenantId, userId: pendingUserId, activityId: lectureId, minutes: 55 });

    const requested = await requestCertificate({
      tenantId,
      eventId,
      userId: pendingUserId,
      kind: 'ATTENDANCE',
    });

    expect(requested.ok, requested.ok ? 'ok' : requested.message).toBe(true);
    if (!requested.ok) return;

    expect(requested.status).toBe('QUEUED');

    const result = await getPublicCertificateDownloadUrl(requested.validationCode);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_STORED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('emissão em lote e isolamento', () => {
  it('emite para os elegíveis e ignora quem não tem fato', async () => {
    const result = await requestEventCertificates({
      tenantId,
      eventId,
      kinds: ['ATTENDANCE', 'MINI_COURSE', 'REVIEWER'],
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const userIds = new Set(result.certificates.map((certificate) => certificate.userId));

    expect(userIds.has(participantId)).toBe(true);
    expect(userIds.has(reviewerId)).toBe(true);
    // Sem presença, sem parecer e sem trabalho: não entra.
    expect(userIds.has(outsiderId)).toBe(false);
  });

  it('lista apenas os certificados do próprio tenant', async () => {
    const mine = await listCertificates({ tenantId });
    const other = await listCertificates({ tenantId: otherTenantId });

    expect(mine.ok && other.ok).toBe(true);
    if (!mine.ok || !other.ok) return;

    expect(mine.certificates.length).toBeGreaterThan(0);
    expect(other.certificates).toHaveLength(0);
  });

  it('a validação pública atravessa tenants (é o propósito do QR)', async () => {
    const list = await listCertificates({ tenantId, userId: reviewerId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const code = list.certificates[0]!.validationCode;
    const validation = await getPublicCertificate(code);

    expect(validation.ok && validation.verdict.status).toBe('VALID');
  });
});
