/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A POLÍTICA DO EVENTO VALE NA EMISSÃO — e o documento guarda a regra
 *  (FASE 86 · fatia 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA (com banco real)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. um evento com `settings.certificatePolicy` gravada emite com ELA: quem passa
 *     nos 75 % e falha nos 90 % (48 de 60 min) é RECUSADO, e o motivo cita 90 %;
 *  2. o `workloadBreakdown` do certificado emitido congela a política aplicada;
 *  3. o evento SEM configuração continua emitindo pela política padrão — e o
 *     detalhamento registra o padrão, porque é a regra que decidiu;
 *  4. gravar a política PRESERVA as outras chaves do `settings` e deixa trilha;
 *  5. valor inválido é RECUSADO pelo serviço antes de tocar no banco (o mesmo
 *     leitor da emissão), com o motivo em `details`.
 *
 *  A emissão usa a MESMA `evaluateEligibility` do preview; a igualdade entre os
 *  dois já é catraca da F85/F86 e não é repetida aqui — aqui a pergunta é "a
 *  política gravada entra em vigor?".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  previewEventCertificates,
  requestCertificate,
  requestEventCertificates,
  verifyCertificateIntegrity,
} from '../../src/lib/certificates/certificate-service';
import { saveCertificatePolicy } from '../../src/lib/certificates/certificate-policy-service';
import { summarizeEventPreview } from '../../src/domain/certificates/certificate-preview-rules';
import {
  policyDefaults,
  type CertificatePolicy,
} from '../../src/domain/certificates/certificate-policy-rules';
import type { CertificateKind } from '../../src/domain/certificates/certificate-rules';

const RUN = randomUUID().slice(0, 8);
const KINDS: readonly CertificateKind[] = ['ATTENDANCE', 'MINI_COURSE'];
const STARTS_AT = new Date('2026-09-17T12:00:00.000Z');

let tenantId: string;

const emails: string[] = [];
const userIds: Record<string, string> = {};

async function createUser(key: string, name: string): Promise<string> {
  const id = randomUUID();
  const email = `f86.politica.${RUN}.${key}@exemplo.test`;
  emails.push(email);

  await adminPrisma.user.create({ data: { id, name, email, emailVerified: true } });

  userIds[key] = id;

  return id;
}

/** Evento + uma atividade de 60 min — a mesma carga em todos os cenários. */
async function createEventWithActivity(input: {
  key: string;
  settings?: Record<string, unknown> | null;
}): Promise<{ eventId: string; activityId: string }> {
  const eventId = randomUUID();
  const activityId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-politica-${input.key}-${RUN}`,
        title: `Congresso da Política ${input.key} ${RUN}`,
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt: STARTS_AT,
        endsAt: new Date(STARTS_AT.getTime() + 2 * 86_400_000),
        timezone: 'America/Bahia',
        confirmedCount: 0,
        ...(input.settings === undefined ? {} : { settings: input.settings as unknown as object }),
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: `minicurso-politica-${input.key}-${RUN}`,
        title: `Minicurso da Política ${input.key}`,
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt: STARTS_AT,
        endsAt: new Date(STARTS_AT.getTime() + 60 * 60_000),
        workloadMinutes: 60,
      },
    });
  });

  return { eventId, activityId };
}

/** Presença medida, com entrada e saída — o que `computeWorkload` consome. */
async function createAttendance(input: {
  eventId: string;
  activityId: string;
  userId: string;
  minutes: number;
}): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const registrationId = randomUUID();

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: STARTS_AT,
      },
    });

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        registrationId,
        userId: input.userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: STARTS_AT,
        checkedOutAt: new Date(STARTS_AT.getTime() + input.minutes * 60_000),
        minutesAttended: input.minutes,
      },
    });
  });
}

const EVENT_POLICY = { eventId: '', activityId: '' };
const EVENT_DEFAULT = { eventId: '', activityId: '' };
const EVENT_PRESERVE = { eventId: '', activityId: '' };

beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f86-politica-${RUN}`,
      name: `Instituição da Política ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await createUser('ana', 'Ana Integral');
  await createUser('bruno', 'Bruno Nos 80 %');
  await createUser('gestor', 'Gestor da Política');

  /**
   * O evento da POLÍTICA: 90 % da carga, piso de 30 min. Ana cumpriu 100 %;
   * Bruno cumpriu 80 % — passa na régua padrão (75 %) e falha nesta.
   */
  const policyEvent = await createEventWithActivity({
    key: 'noventa',
    settings: {
      certificatePolicy: {
        minRatio: 0.9,
        minMinutes: 30,
        requireCheckOut: true,
        aggregateBy: 'ACTIVITY',
      },
    },
  });
  EVENT_POLICY.eventId = policyEvent.eventId;
  EVENT_POLICY.activityId = policyEvent.activityId;

  await createAttendance({ ...policyEvent, userId: userIds.ana!, minutes: 60 });
  await createAttendance({ ...policyEvent, userId: userIds.bruno!, minutes: 48 });

  // O evento SEM configuração: a política padrão é a que decide (e é congelada).
  const defaultEvent = await createEventWithActivity({ key: 'padrao', settings: null });
  EVENT_DEFAULT.eventId = defaultEvent.eventId;
  EVENT_DEFAULT.activityId = defaultEvent.activityId;

  await createAttendance({ ...defaultEvent, userId: userIds.bruno!, minutes: 48 });

  /**
   * O evento da GRAVAÇÃO: já tem outras chaves em `settings` (a política de
   * inscrição da F12 e uma chave imaginária de outra fase) — nenhuma pode sumir.
   */
  const preserveEvent = await createEventWithActivity({
    key: 'preserva',
    settings: {
      registrationRequiresMembership: true,
      chaveDeOutraFase: { intacta: true },
      certificatePolicy: { minRatio: 0.8, minMinutes: 45 },
    },
  });
  EVENT_PRESERVE.eventId = preserveEvent.eventId;
  EVENT_PRESERVE.activityId = preserveEvent.activityId;
});

afterAll(async () => {
  // A catraca de fixtures da FASE 83: instituição criada é instituição apagada.
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { in: emails } } });
  await adminPrisma.$disconnect();
});

describe('a política gravada vale na emissão', () => {
  it('a simulação aplica os 90 % e Bruno (80 %) aparece descartado com o motivo', async () => {    const preview = await previewEventCertificates({
      tenantId,
      eventId: EVENT_POLICY.eventId,
      kinds: KINDS,
    });

    expect(preview.ok, preview.ok ? 'ok' : preview.message).toBe(true);
    if (!preview.ok) return;

    const summary = summarizeEventPreview({
      scope: preview.preview.scope,
      people: preview.preview.people,
    });

    // Duas pessoas no escopo, UMA elegível (Ana) e DOIS descartes (Bruno × 2 tipos).
    expect(summary.scope).toBe(2);
    expect(summary.eligiblePeople).toBe(1);
    expect(summary.certificatesToIssue).toBe(2);
    expect(summary.discarded).toHaveLength(2);
    expect(summary.discarded.map((item) => item.userId)).toEqual([
      userIds.bruno,
      userIds.bruno,
    ]);
    // O texto do domínio acompanha a política — não diz 75 %.
    expect(summary.discarded[0]?.reason).toBe(
      'Nenhuma atividade com presença suficiente (mínimo de 90 % da carga).',
    );
  });

  it('a emissão RECUSA Bruno (80 %) e EMITE para Ana (100 %), com a política no detalhamento', async () => {
    const refused = await requestCertificate({
      tenantId,
      eventId: EVENT_POLICY.eventId,
      userId: userIds.bruno!,
      kind: 'ATTENDANCE',
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('NOT_ELIGIBLE');
      expect(refused.message).toContain('90 %');
    }

    const issued = await requestCertificate({
      tenantId,
      eventId: EVENT_POLICY.eventId,
      userId: userIds.ana!,
      kind: 'ATTENDANCE',
    });

    expect(issued.ok, issued.ok ? 'ok' : issued.message).toBe(true);
    if (!issued.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: issued.certificateId },
        select: { workloadMinutes: true, workloadBreakdown: true },
      }),
    );

    expect(row.workloadMinutes).toBe(60);

    const breakdown = row.workloadBreakdown as unknown as {
      policy: CertificatePolicy;
      entries: { counted: boolean; countedMinutes: number }[];
    };

    expect(breakdown.policy).toEqual({
      minRatio: 0.9,
      minMinutes: 30,
      requireCheckOut: true,
      aggregateBy: 'ACTIVITY',
    });
    expect(breakdown.entries[0]).toMatchObject({ counted: true, countedMinutes: 60 });
  });

  it('o LOTE usa a política: emite para Ana (os dois tipos) e descarta Bruno nos dois', async () => {
    const batch = await requestEventCertificates({
      tenantId,
      eventId: EVENT_POLICY.eventId,
      kinds: KINDS,
    });

    expect(batch.ok, batch.ok ? 'ok' : batch.message).toBe(true);
    if (!batch.ok) return;

    /**
     * Ana já tem o ATTENDANCE da emissão individual acima; o lote o devolve como
     * `existing` e cria o MINI_COURSE. Bruno (80 %) é recusado nos dois tipos — o
     * lote passa pelo MESMO `requestCertificate`, então a política vale aqui sem
     * uma segunda implementação.
     */
    expect(batch.requested).toBe(2);
    expect(batch.skipped).toBe(2);
    expect(batch.certificates.every((item) => item.userId === userIds.ana)).toBe(true);
    expect(batch.discarded.map((item) => item.userId)).toEqual([userIds.bruno, userIds.bruno]);
    expect(batch.discarded.every((item) => item.reason.includes('90 %'))).toBe(true);

    const created = await withTenant(tenantId, (tx) =>
      tx.certificate.findMany({
        where: { tenantId, eventId: EVENT_POLICY.eventId },
        select: { userId: true, kind: true },
      }),
    );

    expect(created).toHaveLength(2);
    expect(created.every((row) => row.userId === userIds.ana)).toBe(true);
    expect(created.map((row) => row.kind).sort()).toEqual(['ATTENDANCE', 'MINI_COURSE']);
  });

  it('adulterar a política no detalhamento NÃO invalida a assinatura (o breakdown não é assinado)', async () => {
    const certificate = await withTenant(tenantId, (tx) =>
      tx.certificate.findFirstOrThrow({
        where: { tenantId, eventId: EVENT_POLICY.eventId, userId: userIds.ana!, kind: 'ATTENDANCE' },
        select: { id: true, contentHash: true },
      }),
    );

    const before = await verifyCertificateIntegrity(certificate.id, tenantId);
    expect(before.signatureValid).toBe(true);
    expect(before.hasSignature).toBe(true);

    /**
     * O `workloadBreakdown` NÃO entra em `buildCanonicalPayload`/`V2`. Trocar a
     * política gravada ali muda a EXPLICAÇÃO do documento, não o que ele afirma —
     * e a assinatura continua conferindo. É a consequência declarada da decisão de
     * não criar a v3 do documento só para assinar o detalhamento.
     */
    await withTenant(tenantId, (tx) =>
      tx.certificate.update({
        where: { id: certificate.id },
        data: {
          workloadBreakdown: {
            policy: { minRatio: 1, minMinutes: 240, requireCheckOut: true, aggregateBy: 'ACTIVITY' },
            entries: [],
          } as unknown as object,
        },
      }),
    );

    const after = await verifyCertificateIntegrity(certificate.id, tenantId);

    expect(after.signatureValid).toBe(true);
    expect(after.contentHash).toBe(certificate.contentHash);
    expect(after.contentHash).toBe(before.contentHash);
  });

  it('sem configuração, a emissão usa o PADRÃO e o congela no detalhamento', async () => {
    const issued = await requestCertificate({
      tenantId,
      eventId: EVENT_DEFAULT.eventId,
      userId: userIds.bruno!,
      kind: 'ATTENDANCE',
    });

    // 48 de 60 é 80 % — passa nos 75 % padrão.
    expect(issued.ok, issued.ok ? 'ok' : issued.message).toBe(true);
    if (!issued.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: issued.certificateId },
        select: { workloadBreakdown: true },
      }),
    );

    const breakdown = row.workloadBreakdown as unknown as { policy: CertificatePolicy };

    expect(breakdown.policy).toEqual(policyDefaults());
  });
});

describe('gravar a política: validação, preservação e trilha', () => {
  it('preserva as OUTRAS chaves do settings e registra a alteração na trilha', async () => {
    const result = await saveCertificatePolicy({
      tenantId,
      eventId: EVENT_PRESERVE.eventId,
      actorId: userIds.gestor!,
      policy: {
        minRatio: 0.9,
        minMinutes: 60,
        requireCheckOut: true,
        aggregateBy: 'ACTIVITY',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({
        where: { id: EVENT_PRESERVE.eventId },
        select: { settings: true },
      }),
    );

    const settings = row.settings as Record<string, unknown>;

    // A chave gravada…
    expect(settings.certificatePolicy).toEqual({
      minRatio: 0.9,
      minMinutes: 60,
      requireCheckOut: true,
      aggregateBy: 'ACTIVITY',
    });
    // …e as outras, intactas.
    expect(settings.registrationRequiresMembership).toBe(true);
    expect(settings.chaveDeOutraFase).toEqual({ intacta: true });

    const audit = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'event',
          entityId: EVENT_PRESERVE.eventId,
          action: 'UPDATE',
        },
        orderBy: { createdAt: 'desc' },
        select: { userId: true, changes: true },
      }),
    );

    expect(audit?.userId).toBe(userIds.gestor);
    expect(audit?.changes).toBeTruthy();
  });

  it('RECUSA minRatio 0 antes de tocar no banco, com o motivo em details', async () => {
    const before = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({
        where: { id: EVENT_PRESERVE.eventId },
        select: { settings: true },
      }),
    );

    const result = await saveCertificatePolicy({
      tenantId,
      eventId: EVENT_PRESERVE.eventId,
      actorId: userIds.gestor!,
      policy: { minRatio: 0, minMinutes: 30, requireCheckOut: true, aggregateBy: 'ACTIVITY' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_POLICY');
    expect(result.details?.[0]).toContain('minRatio = 0');

    const after = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({
        where: { id: EVENT_PRESERVE.eventId },
        select: { settings: true },
      }),
    );

    // Nada foi gravado: o settings é o MESMO objeto.
    expect(after.settings).toEqual(before.settings);
  });

  it('RECUSA requireCheckOut false (a política não desliga a prova da saída)', async () => {
    const result = await saveCertificatePolicy({
      tenantId,
      eventId: EVENT_PRESERVE.eventId,
      actorId: userIds.gestor!,
      policy: { minRatio: 0.75, minMinutes: 30, requireCheckOut: false, aggregateBy: 'ACTIVITY' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_POLICY');
    expect(result.details?.[0]).toContain('check-out');
  });

  it('evento de outra instituição não é encontrado (o pertencimento é do where)', async () => {
    const otherTenant = randomUUID();

    try {
      const result = await saveCertificatePolicy({
        tenantId: otherTenant,
        eventId: EVENT_PRESERVE.eventId,
        actorId: userIds.gestor!,
        policy: policyDefaults(),
      });

      // A RLS do outro tenant não enxerga o evento: `NOT_FOUND`, nunca escrita.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    } finally {
      // Nada a limpar: a transação não criou linha (a instituição nem existe).
    }
  });
});
