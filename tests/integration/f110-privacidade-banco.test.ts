/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INTEGRAÇÃO — Privacidade, consentimento versionado, IP mascarado e conta (FASE 110)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { recordAudit } from '../../src/lib/admin/audit';
import { recordIdentityAudit } from '../../src/lib/platform/identity-audit-service';
import { recordCookieConsent } from '../../src/lib/privacy/cookie-consent-service';
import { registerForEvent } from '../../src/lib/events/registration-service';
import { deleteOwnAccount } from '../../src/lib/auth/account-service';
import {
  REGISTRATION_CONSENT_VERSION,
  REGISTRATION_DATA_CONSENT_TEXT,
} from '../../src/domain/events/registration-consent-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let eventSlug: string;
let ownerId: string;
let coOwnerId: string;
let participantId: string;
const consentTokens: string[] = [];

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  eventSlug = `evt-f110-${RUN}`;
  ownerId = randomUUID();
  coOwnerId = randomUUID();
  participantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `t-f110-${RUN}`,
      name: `Instituição F110 ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
  });

  await adminPrisma.user.createMany({
    data: [
      { id: ownerId, name: 'Dona Única', email: `f110.owner.${RUN}@exemplo.test` },
      { id: coOwnerId, name: 'Co-Dona', email: `f110.coowner.${RUN}@exemplo.test` },
      { id: participantId, name: 'Participante LGPD', email: `f110.part.${RUN}@exemplo.test` },
    ],
  });

  await adminPrisma.account.create({
    data: {
      id: randomUUID(),
      accountId: participantId,
      providerId: 'credential',
      userId: participantId,
      password: 'hashed-password-placeholder',
    },
  });

  await withTenant(tenantId, async (tx) => {
    await tx.userTenantProfile.createMany({
      data: [
        { id: randomUUID(), tenantId, userId: ownerId, kind: 'MEMBER', status: 'ACTIVE' },
        { id: randomUUID(), tenantId, userId: participantId, kind: 'PARTICIPANT', status: 'ACTIVE' },
      ],
    });

    await tx.roleAssignment.createMany({
      data: [
        { id: randomUUID(), tenantId, userId: ownerId, role: 'OWNER', scope: 'TENANT' },
        { id: randomUUID(), tenantId, userId: participantId, role: 'PARTICIPANT', scope: 'TENANT' },
      ],
    });

    const startsAt = new Date(Date.now() + 14 * 86_400_000);
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: `Simpósio F110 ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        timezone: 'America/Bahia',
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 10 * 86_400_000),
      },
    });
  });
});

afterAll(async () => {
  if (consentTokens.length > 0) {
    await adminPrisma.cookieConsent.deleteMany({ where: { consentToken: { in: consentTokens } } });
  }
  await adminPrisma.identityAuditLog.deleteMany({
    where: { userId: { in: [ownerId, coOwnerId, participantId] } },
  });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { id: { in: [ownerId, coOwnerId, participantId] } } });
  await adminPrisma.$disconnect();
});

describe('FASE 110 — Contrato de banco e privacidade no PostgreSQL', () => {
  it('bloqueia cookie_consents da role de runtime e grava recibo mascarado via adminPrisma', async () => {
    await expect(
      withTenant(tenantId, async (tx) => {
        await tx.$queryRawUnsafe('SELECT count(*)::int FROM cookie_consents');
      }),
    ).rejects.toThrow();

    const token = `tok-f110-${RUN}-${randomUUID().slice(0, 8)}`;
    consentTokens.push(token);

    const saved = await recordCookieConsent({
      choice: 'ESSENTIAL_ONLY',
      source: 'test-integration',
      existingToken: token,
      ipAddress: '203.0.113.87',
      userAgent: 'Vitest/1.0',
    });

    expect(saved.recordedId).toBeTruthy();

    const row = await adminPrisma.cookieConsent.findUniqueOrThrow({
      where: { id: saved.recordedId! },
    });
    expect(row.essentialAllowed).toBe(true);
    expect(row.preferencesAllowed).toBe(false);
    expect(row.ipAddressMasked).toBe('203.0.113.0');
  });

  it('mascara IPs antes de persistir em audit_logs e identity_audit_logs', async () => {
    const entityUuid = randomUUID();
    await recordAudit({
      tenantId,
      userId: ownerId,
      action: 'READ',
      entityType: 'F110PrivacyCheck',
      entityId: entityUuid,
      ipAddress: '2001:db8:85a3:9999::42',
    });

    const auditRow = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityType: 'F110PrivacyCheck', entityId: entityUuid },
      }),
    );
    expect(auditRow.ipAddress).toBe('2001:db8:85a3::');

    await recordIdentityAudit({
      userId: ownerId,
      event: 'PASSWORD_CHANGED',
      ipAddress: '198.51.100.211',
    });

    const idRow = await adminPrisma.identityAuditLog.findFirstOrThrow({
      where: { userId: ownerId, event: 'PASSWORD_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(idRow.ipAddress).toBe('198.51.100.0');
  });

  it('salva snapshot versionado do consentimento ao registrar inscrição no evento', async () => {
    const reg = await registerForEvent({
      tenantId,
      eventSlug,
      userId: participantId,
      consentData: true,
      consentImage: false,
      accessibilityNotes: 'Intérprete de Libras',
      formResponses: { institucional_custom: 'Universidade Federal', termo_extra: 'ok' },
    });

    expect(reg.ok).toBe(true);
    if (!reg.ok) return;

    const stored = await withTenant(tenantId, (tx) =>
      tx.registration.findUniqueOrThrow({
        where: { id: reg.registrationId },
        select: { consentVersion: true, consentText: true, consentData: true, consentImage: true },
      }),
    );

    expect(stored.consentData).toBe(true);
    expect(stored.consentImage).toBe(false);
    expect(stored.consentVersion).toBe(REGISTRATION_CONSENT_VERSION);
    expect(stored.consentText).toContain(REGISTRATION_DATA_CONSENT_TEXT);
    expect(stored.consentText).toContain('[Imagem:NAO_AUTORIZADO]');
  });

  it('recusa encerramento da última OWNER e anonimiza completamente participante liberando vaga futura', async () => {
    const blocked = await deleteOwnAccount({
      userId: ownerId,
      confirmationPhrase: 'EXCLUIR MINHA CONTA',
    });
    expect(blocked).toMatchObject({ ok: false, code: 'SOLE_OWNER_OF_TENANT' });

    // Participante com senha incorreta é recusado antes de alterar qualquer tabela
    const wrongPass = await deleteOwnAccount({
      userId: participantId,
      confirmationPhrase: 'EXCLUIR MINHA CONTA',
      currentPassword: 'errada',
      verifyPassword: async () => false,
    });
    expect(wrongPass).toMatchObject({ ok: false, code: 'INVALID_PASSWORD' });

    const deleted = await deleteOwnAccount({
      userId: participantId,
      confirmationPhrase: 'EXCLUIR MINHA CONTA',
      currentPassword: 'correta',
      verifyPassword: async (pwd) => pwd === 'correta',
    });
    expect(deleted).toEqual({ ok: true });

    const anonUser = await adminPrisma.user.findUniqueOrThrow({
      where: { id: participantId },
    });
    expect(anonUser.deletedAt).not.toBeNull();
    expect(anonUser.banned).toBe(true);
    expect(anonUser.email).toBe(`deleted-${participantId}@anon.invalid`);

    const regAfter = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { eventId, userId: participantId },
        select: { status: true, accessibilityNotes: true, formResponses: true },
      }),
    );
    expect(regAfter.status).toBe('CANCELED');
    expect(regAfter.accessibilityNotes).toBeNull();
    expect(regAfter.formResponses).toEqual({});

    const membershipAfter = await adminPrisma.userTenantProfile.findFirstOrThrow({
      where: { tenantId, userId: participantId },
    });
    expect(membershipAfter.status).toBe('REMOVED');
    expect(membershipAfter.deletedAt).not.toBeNull();
  });
});
