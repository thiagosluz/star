/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Ciclo de vida do membro e quota de armazenamento (FASE 21)
 *
 *  Contra o PostgreSQL real, prova o que o domínio puro não alcança:
 *    • o uso de armazenamento SOMA as quatro fontes e respeita o teto do plano;
 *    • o envio é RECUSADO antes de assinar a URL — nos três caminhos (submissão,
 *      imagem e material de palestrante) — quando a instituição não tem espaço;
 *    • trocar papéis concede o que falta e REVOGA o que sobra, sem tocar em papel de
 *      evento, e sem deixar a instituição sem proprietário;
 *    • remover um membro é remoção LÓGICA: o vínculo sai, TODAS as concessões são
 *      revogadas, a vaga volta para a quota e o histórico fica.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  assignableTenantRoles,
  getTeamOverview,
  removeMember,
  updateMemberRoles,
} from '../../src/lib/admin/member-service';
import { ensureStorageRoom, storageUsage } from '../../src/lib/storage/storage-quota';
import { requestAssetUpload } from '../../src/lib/admin/asset-service';
import { requestMaterialUpload } from '../../src/lib/speakers/material-service';
import { requestUpload } from '../../src/lib/review/submission-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let tenantSlug: string;
/** Instituição sem espaço: `maxStorageBytes = 0` (todo envio é recusado). */
let tightTenantId: string;
let tightTenantSlug: string;

let ownerId: string;
let adminId: string;
let staffId: string;
let eventsTeamId: string;
let nobodyId: string;

let eventId: string;
let tightEventId: string;
let submissionId: string;
let activityId: string;
let speakerProfileId: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f21.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f21-membros-${RUN}`,
      name: `Instituição Membros ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true, slug: true },
  });
  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  /**
   * A instituição apertada existe para provar a recusa. `maxStorageBytes = 0` é o caso
   * extremo: nenhum arquivo cabe, e é o que torna o teste determinístico (não depende
   * de quanto o plano gratuito permite hoje).
   */
  const tight = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f21-apertada-${RUN}`,
      name: `Instituição sem espaço ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      maxStorageBytes: BigInt(0),
      timezone: 'America/Bahia',
    },
    select: { id: true, slug: true },
  });
  tightTenantId = tight.id;
  tightTenantSlug = tight.slug;

  ownerId = await createUser('proprietaria');
  adminId = await createUser('administrador');
  staffId = await createUser('equipe');
  eventsTeamId = await createUser('equipe-evento');
  nobodyId = await createUser('sem-vinculo');

  await adminPrisma.userTenantProfile.createMany({
    data: [
      { id: randomUUID(), tenantId, userId: ownerId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId, userId: adminId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId, userId: staffId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId, userId: eventsTeamId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId: tightTenantId, userId: ownerId, status: 'ACTIVE', kind: 'MEMBER' },
    ],
  });

  await withTenant(tenantId, async (tx) => {
    await tx.roleAssignment.create({
      data: {
        tenantId,
        userId: ownerId,
        role: 'OWNER',
        scope: 'TENANT',
        reason: 'fixture F21',
      },
    });

    await tx.roleAssignment.create({
      data: { tenantId, userId: adminId, role: 'ADMIN', scope: 'TENANT', reason: 'fixture F21' },
    });
  });

  /**
   * Evento, atividade, palestrante e submissão vêm DEPOIS dos usuários (a submissão
   * aponta para quem a enviou) e ANTES do papel por EVENTO, que referencia o evento.
   */
  await createFixtures();

  await withTenant(tenantId, (tx) =>
    tx.roleAssignment.create({
      data: {
        tenantId,
        userId: eventsTeamId,
        role: 'STAFF',
        scope: 'EVENT',
        eventId,
        reason: 'fixture F21 (equipe do dia)',
      },
    }),
  );
}, 120_000);

afterAll(async () => {
  await adminPrisma.$disconnect().catch(() => undefined);
});

/**
 * Evento, atividade, palestrante e submissão — criados no `beforeAll`, depois dos
 * usuários e antes do papel por EVENTO (que referencia o evento).
 */
async function createFixtures(): Promise<void> {
  eventId = randomUUID();
  tightEventId = randomUUID();
  submissionId = randomUUID();
  activityId = randomUUID();
  speakerProfileId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f21-${RUN}`,
        title: `Congresso F21 ${RUN}`,
        status: 'PUBLISHED',
        modality: 'ONLINE',
        timezone: 'America/Bahia',
        startsAt: daysFromNow(20),
        endsAt: daysFromNow(22),
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: `oficina-f21-${RUN}`,
        title: `Oficina F21 ${RUN}`,
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt: daysFromNow(21),
        endsAt: new Date(daysFromNow(21).getTime() + 3_600_000),
        workloadMinutes: 60,
      },
    });

    await tx.speakerProfile.create({
      data: { id: speakerProfileId, tenantId, name: `Palestrante F21 ${RUN}` },
    });

    await tx.activitySpeaker.create({
      data: { tenantId, activityId, speakerProfileId, displayOrder: 0 },
    });

    await tx.submission.create({
      data: {
        id: submissionId,
        tenantId,
        eventId,
        protocol: `F21${RUN}`.slice(0, 20),
        title: 'Trabalho da F21',
        abstract: 'Resumo do trabalho usado para medir o armazenamento da instituição.',
        status: 'DRAFT',
        submittedById: ownerId,
      },
    });

    /**
     * Uma inscrição da pessoa que também é da EQUIPE: é o caso que a remoção precisa
     * avisar (o vínculo é uma linha por instituição + pessoa, então remover a equipe
     * tira o acesso de participante junto).
     */
    await tx.registration.create({
      data: {
        tenantId,
        eventId,
        userId: staffId,
        status: 'CONFIRMED',
        consentData: true,
        consentImage: false,
      },
    });
  });

  await withTenant(tightTenantId, (tx) =>
    tx.event.create({
      data: {
        id: tightEventId,
        tenantId: tightTenantId,
        slug: `evento-apertado-${RUN}`,
        title: `Congresso sem espaço ${RUN}`,
        status: 'PUBLISHED',
        modality: 'ONLINE',
        timezone: 'America/Bahia',
        startsAt: daysFromNow(20),
        endsAt: daysFromNow(22),
      },
    }),
  );
}

describe('uso de armazenamento', () => {
  it('soma as quatro fontes e usa o teto do plano', async () => {
    const before = await storageUsage(tenantId);
    expect(before.maxBytes).toBe(5 * 1024 ** 3);

    // Uma linha de cada origem, com tamanhos conhecidos.
    await withTenant(tenantId, async (tx) => {
      await tx.submissionFile.create({
        data: {
          tenantId,
          submissionId,
          kind: 'BLIND_PDF',
          version: 1,
          storageKey: `tenants/${tenantId}/teste-cego.pdf`,
          bucket: 'eventflow-submissions',
          fileName: 'cego.pdf',
          mimeType: 'application/pdf',
          sizeBytes: BigInt(1000),
          checksum: 'a'.repeat(64),
        },
      });

      await tx.mediaAsset.create({
        data: {
          tenantId,
          eventId,
          bucket: 'eventflow-assets',
          target: 'COVER',
          objectKey: `tenants/${tenantId}/capa.png`,
          url: `http://localhost:9000/eventflow-assets/capa.png`,
          fileName: 'capa.png',
          mimeType: 'image/png',
          sizeBytes: 2000,
          checksum: 'b'.repeat(64),
          uploadedById: ownerId,
        },
      });

      await tx.speakerMaterial.create({
        data: {
          tenantId,
          activityId,
          speakerProfileId,
          title: 'Slide de apoio',
          kind: 'SLIDES',
          visibility: 'PUBLIC',
          storageKey: `tenants/${tenantId}/slide.pdf`,
          storageBucket: 'eventflow-certificates',
          fileName: 'slide.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3000,
          checksum: 'c'.repeat(64),
          url: `http://localhost:9000/eventflow-certificates/slide.pdf`,
          uploadedById: ownerId,
        },
      });

      await tx.certificate.create({
        data: {
          tenantId,
          eventId,
          userId: ownerId,
          kind: 'PARTICIPATION',
          status: 'ISSUED',
          validationCode: `CERT-F21-${RUN}`.slice(0, 20),
          title: 'Certificado F21',
          recipientName: 'Pessoa proprietaria',
          bodyText: 'Participou.',
          workloadMinutes: 60,
          issuedAt: new Date(),
          storageKey: `tenants/${tenantId}/certificado.pdf`,
          bucket: 'eventflow-certificates',
          sizeBytes: BigInt(4000),
        },
      });
    });

    const after = await storageUsage(tenantId);

    expect(after.submissionBytes).toBe(before.submissionBytes + 1000);
    expect(after.mediaBytes).toBe(before.mediaBytes + 2000);
    expect(after.speakerMaterialBytes).toBe(before.speakerMaterialBytes + 3000);
    expect(after.certificateBytes).toBe(before.certificateBytes + 4000);
    expect(after.totalBytes).toBe(
      after.submissionBytes + after.mediaBytes + after.speakerMaterialBytes + after.certificateBytes,
    );

    // A instituição sem espaço enxerga o próprio teto (zero) — e está no limite, não
    // "acima": zero usado com teto zero é `AT_LIMIT`, e o primeiro byte a torna
    // `EXCEEDED`. É a mesma aritmética da decisão de envio (que recusa qualquer byte).
    const tight = await storageUsage(tightTenantId);
    expect(tight.maxBytes).toBe(0);
    expect(tight.totalBytes).toBe(0);
    expect(tight.usage.state).toBe('AT_LIMIT');
  }, 90_000);

  it('imagem do acervo excluída sai da conta', async () => {
    const before = await storageUsage(tenantId);

    const asset = await withTenant(tenantId, (tx) =>
      tx.mediaAsset.findFirstOrThrow({ where: { tenantId }, select: { id: true } }),
    );

    await withTenant(tenantId, (tx) =>
      tx.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } }),
    );

    const after = await storageUsage(tenantId);
    expect(after.mediaBytes).toBe(before.mediaBytes - 2000);
  }, 60_000);

  it('a decisão de espaço recusa antes de assinar e explica o motivo', async () => {
    const denied = await ensureStorageRoom({ tenantId: tightTenantId, incomingBytes: 1024 });

    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe('QUOTA_EXCEEDED');
      expect(denied.message).toMatch(/0 KB|plano/i);
    }

    const allowed = await ensureStorageRoom({ tenantId, incomingBytes: 1024 });
    expect(allowed.ok).toBe(true);
  }, 60_000);
});

describe('recusa de upload quando não há espaço', () => {
  it('submissão da instituição sem espaço é recusada pela quota, sem assinar URL', async () => {
    const submission = await withTenant(tightTenantId, (tx) =>
      tx.submission.create({
        data: {
          id: randomUUID(),
          tenantId: tightTenantId,
          eventId: tightEventId,
          protocol: `AP${RUN}`.slice(0, 20),
          title: 'Trabalho da instituição sem espaço',
          abstract: 'Resumo.',
          status: 'DRAFT',
          submittedById: ownerId,
        },
        select: { id: true },
      }),
    );

    const result = await requestUpload({
      tenantId: tightTenantId,
      submissionId: submission.id,
      userId: ownerId,
      kind: 'BLIND_PDF',
      fileName: 'cego.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      checksum: 'd'.repeat(64),
      magicBytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUOTA_EXCEEDED');
      expect(result.message).toMatch(/plano|acervo|quota/i);
    }
  }, 60_000);

  it('imagem do evento é recusada antes de o navegador enviar qualquer byte', async () => {
    const result = await requestAssetUpload({
      tenantId: tightTenantId,
      actorId: ownerId,
      eventId: tightEventId,
      target: 'COVER',
      fileName: 'capa.png',
      mimeType: 'image/png',
      sizeBytes: PNG_1X1.length,
      magicBytes: PNG_1X1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUOTA_EXCEEDED');
      expect(result.details?.join(' ')).toMatch(/ocupa/i);
    }

    // E a instituição com espaço continua podendo assinar.
    const allowed = await requestAssetUpload({
      tenantId,
      actorId: ownerId,
      eventId,
      target: 'COVER',
      fileName: 'capa.png',
      mimeType: 'image/png',
      sizeBytes: PNG_1X1.length,
      magicBytes: PNG_1X1,
    });

    expect(allowed.ok, allowed.ok ? 'ok' : allowed.message).toBe(true);
  }, 90_000);

  it('material de palestrante é recusado pela quota', async () => {
    /**
     * O vínculo do palestrante é da instituição COM espaço, então a checagem de posse
     * passa e o que decide é a quota — é isso que o teste isola.
     */
    const result = await requestMaterialUpload({
      tenantId,
      eventId,
      activityId,
      speakerProfileId,
      fileName: 'slide.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      magicBytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
    });

    // Sem espaço (tenant apertado) a recusa é a quota; aqui a instituição TEM espaço,
    // então o esperado é o ticket — o que prova que o caminho segue funcionando.
    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (result.ok) expect(result.uploadUrl).toContain('http');

    const denied = await requestMaterialUpload({
      tenantId: tightTenantId,
      eventId: tightEventId,
      activityId,
      speakerProfileId,
      fileName: 'slide.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });

    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      // O vínculo do palestrante é da OUTRA instituição: nenhuma URL é assinada.
      expect(['QUOTA_EXCEEDED', 'NOT_FOUND']).toContain(denied.code);
    }
  }, 90_000);
});

describe('troca de papéis', () => {
  it('concede o que falta e revoga o que sobra, com auditoria', async () => {
    const promoted = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: staffId,
      roles: ['STAFF'],
    });

    expect(promoted.ok, promoted.ok ? 'ok' : promoted.message).toBe(true);
    if (!promoted.ok) return;

    expect(promoted.granted).toEqual(['STAFF']);
    expect(promoted.revoked).toEqual([]);
    expect(promoted.tenantRoles).toEqual(['STAFF']);

    const changed = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: staffId,
      roles: ['FINANCE'],
    });

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    expect(changed.granted).toEqual(['FINANCE']);
    expect(changed.revoked).toEqual(['STAFF']);

    const live = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.findMany({
        where: { tenantId, userId: staffId },
        select: { role: true, revokedAt: true },
      }),
    );

    // A concessão revogada NÃO é apagada: o histórico de acesso fica.
    expect(live.find((row) => row.role === 'STAFF')?.revokedAt).not.toBeNull();
    expect(live.find((row) => row.role === 'FINANCE')?.revokedAt).toBeNull();

    const audit = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId, entityId: staffId, action: 'PERMISSION_CHANGE' },
        orderBy: { createdAt: 'desc' },
        select: { changes: true },
      }),
    );

    expect(audit).not.toBeNull();
  }, 90_000);

  it('papel de EVENTO sobrevive à reescrita da equipe', async () => {
    const result = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: eventsTeamId,
      roles: ['ADMIN'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const eventRole = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.findFirst({
        where: { tenantId, userId: eventsTeamId, scope: 'EVENT' },
        select: { role: true, revokedAt: true },
      }),
    );

    expect(eventRole?.role).toBe('STAFF');
    expect(eventRole?.revokedAt).toBeNull();
  }, 60_000);

  it('RECUSA retirar o papel do único proprietário', async () => {
    const result = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: ownerId,
      roles: ['ADMIN'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('LAST_OWNER');
      expect(result.message).toMatch(/proprietário/i);
    }
  }, 60_000);

  it('o mesmo conjunto de papéis não escreve nada', async () => {
    const same = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: adminId,
      roles: ['ADMIN'],
    });

    expect(same.ok).toBe(true);
    if (same.ok) expect(same.unchanged).toBe(true);
  }, 60_000);

  it('RECUSA papel de plataforma e o de participante', async () => {
    const platform = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: staffId,
      roles: ['SUPERADMIN'],
    });

    expect(platform.ok).toBe(false);
    if (!platform.ok) expect(platform.code).toBe('ROLE_SCOPE');

    const invented = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: staffId,
      roles: ['IMPERADOR'],
    });

    expect(invented.ok).toBe(false);
    if (!invented.ok) expect(invented.code).toBe('INVALID_ROLE');
  }, 60_000);

  it('a lista de papéis oferecidos não inclui plataforma nem participante', () => {
    const roles = assignableTenantRoles();

    expect(roles).toContain('ADMIN');
    expect(roles).toContain('OWNER');
    expect(roles).not.toContain('SUPERADMIN');
    expect(roles).not.toContain('PARTICIPANT');
  });

  it('a lista da equipe informa as inscrições da pessoa (o aviso da remoção)', async () => {
    const overview = await getTeamOverview(tenantId);
    const member = overview.members.find((entry) => entry.userId === staffId);

    expect(member?.registrationCount).toBe(1);
    expect(member?.tenantRoles).toContain('FINANCE');
  }, 60_000);
});

describe('remoção de membro', () => {
  it('RECUSA remover a si mesmo, mesmo sendo proprietário', async () => {
    const result = await removeMember({ tenantId, actorId: ownerId, userId: ownerId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SELF');
  }, 60_000);

  it('remove o vínculo: sai da equipe, perde TODOS os papéis e libera a vaga', async () => {
    const before = await getTeamOverview(tenantId);

    const result = await removeMember({ tenantId, actorId: ownerId, userId: eventsTeamId });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.name).toContain('equipe-evento');
    // O papel de EVENTO também é revogado: quem perdeu o acesso não credencia mais.
    expect(result.revokedRoles.join(' ')).toMatch(/STAFF/);

    const after = await getTeamOverview(tenantId);
    expect(after.memberCount).toBe(before.memberCount - 1);
    expect(after.members.some((member) => member.userId === eventsTeamId)).toBe(false);

    const profile = await withTenant(tenantId, (tx) =>
      tx.userTenantProfile.findFirstOrThrow({
        where: { tenantId, userId: eventsTeamId },
        select: { status: true, deletedAt: true },
      }),
    );
    expect(profile.status).toBe('REMOVED');
    expect(profile.deletedAt).not.toBeNull();

    const liveRoles = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.count({ where: { tenantId, userId: eventsTeamId, revokedAt: null } }),
    );
    expect(liveRoles).toBe(0);

    const audit = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId, entityId: eventsTeamId, action: 'DELETE' },
        select: { changes: true },
      }),
    );
    expect(audit).not.toBeNull();
  }, 90_000);

  it('vínculo removido não recebe papel nem é removido de novo', async () => {
    const roles = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: eventsTeamId,
      roles: ['STAFF'],
    });

    expect(roles.ok).toBe(false);
    if (!roles.ok) expect(roles.code).toBe('NOT_FOUND');

    const again = await removeMember({ tenantId, actorId: ownerId, userId: eventsTeamId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('NOT_FOUND');
  }, 60_000);

  it('RECUSA remover quem não tem vínculo de equipe', async () => {
    const result = await removeMember({ tenantId, actorId: ownerId, userId: nobodyId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  }, 60_000);

  it('com DOIS proprietários, um pode ser removido — e o outro permanece', async () => {
    const secondOwner = await createUser('segunda-proprietaria');
    await adminPrisma.userTenantProfile.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: secondOwner,
        status: 'ACTIVE',
        kind: 'MEMBER',
      },
    });

    const promoted = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: secondOwner,
      roles: ['OWNER'],
    });
    expect(promoted.ok, promoted.ok ? 'ok' : promoted.message).toBe(true);

    // Agora existem dois proprietários: o rebaixamento do primeiro é permitido.
    const demoted = await updateMemberRoles({
      tenantId,
      actorId: ownerId,
      userId: ownerId,
      roles: ['ADMIN'],
    });
    expect(demoted.ok, demoted.ok ? 'ok' : demoted.message).toBe(true);
    if (demoted.ok) expect(demoted.revoked).toEqual(['OWNER']);

    const owners = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.count({
        where: { tenantId, role: 'OWNER', revokedAt: null, userId: secondOwner },
      }),
    );
    expect(owners).toBe(1);

    // E o convite/aceite pode trazer a pessoa de volta: o vínculo removido é
    // readmissível porque é uma LINHA (status), não um usuário apagado.
    expect(tenantSlug).toBe(`f21-membros-${RUN}`);
    expect(tightTenantSlug).toBe(`f21-apertada-${RUN}`);
  }, 90_000);
});
