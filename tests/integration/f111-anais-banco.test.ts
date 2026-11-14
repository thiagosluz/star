/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Publicação de Anais, RLS e OAI-PMH (FASE 111)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  getAdminProceedingsOverview,
  getPublicProceedingsByEventSlug,
  getPublicProceedingsWork,
  importAcceptedSubmissionsToProceedings,
  publishProceedingsVolume,
  resolvePublicProceedingsPdf,
  unpublishProceedingsVolume,
  updateProceedingsEntry,
  upsertProceedingsVolume,
} from '../../src/lib/proceedings/proceedings-service';
import {
  loadGlobalOaiRepositoryData,
  listPublicSitemapEntries,
} from '../../src/lib/proceedings/indexing-service';
import { recordProceedingsPermission, requestUpload } from '../../src/lib/review/submission-service';

const RUN = randomUUID().slice(0, 8);
const SLUG_PUBLICA = `f111-pub-${RUN}`;
const SLUG_PRIVADA = `f111-priv-${RUN}`;

let publicTenantId: string;
let privateTenantId: string;
let authorUserId: string;
let publicEventId: string;
let privateEventId: string;
let acceptedSubId: string;
let rejectedSubId: string;

beforeAll(async () => {
  publicTenantId = randomUUID();
  privateTenantId = randomUUID();
  authorUserId = randomUUID();
  publicEventId = randomUUID();
  privateEventId = randomUUID();
  acceptedSubId = randomUUID();
  rejectedSubId = randomUUID();

  await adminPrisma.user.create({
    data: {
      id: authorUserId,
      email: `autor-f111-${RUN}@teste.local`,
      name: 'Maria Clara Pesquisadora',
      orcidId: '0000-0002-1111-2222',
      emailVerified: true,
    },
  });

  await adminPrisma.tenant.create({
    data: {
      id: publicTenantId,
      slug: SLUG_PUBLICA,
      name: 'Instituto Aberto de Pesquisa',
      status: 'ACTIVE',
      isPublic: true,
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await adminPrisma.tenant.create({
    data: {
      id: privateTenantId,
      slug: SLUG_PRIVADA,
      name: 'Instituição Privada',
      status: 'ACTIVE',
      isPublic: false,
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  await withTenant(publicTenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: publicEventId,
        tenantId: publicTenantId,
        slug: `evento-anais-${RUN}`,
        title: 'Congresso de Computação 2026',
        status: 'PUBLISHED',
        modality: 'HYBRID',
        startsAt: new Date('2026-10-10T12:00:00Z'),
        endsAt: new Date('2026-10-12T20:00:00Z'),
        timezone: 'America/Bahia',
      },
    });

    const trackId = randomUUID();
    await tx.track.create({
      data: {
        id: trackId,
        tenantId: publicTenantId,
        eventId: publicEventId,
        slug: 'sistemas',
        name: 'Sistemas Distribuídos',
      },
    });

    await tx.submission.create({
      data: {
        id: acceptedSubId,
        tenantId: publicTenantId,
        eventId: publicEventId,
        trackId,
        submittedById: authorUserId,
        protocol: `2026-${RUN.slice(0, 4).toUpperCase()}`,
        title: 'Consenso em Ambientes Multi-Tenant com Postgres RLS',
        abstract: 'Estudo prático de isolamento e desempenho sob carga.',
        keywords: ['PostgreSQL', 'RLS'],
        status: 'ACCEPTED',
        finalScore: 95.5,
        decisionNotes: 'Nota confidencial do comitê.',
        blindSnapshot: { reviewerSecret: true },
        authors: {
          create: [
            {
              tenantId: publicTenantId,
              userId: authorUserId,
              guestEmail: 'nao-deve-vazar@privado.local',
              institution: 'UFBA',
              authorOrder: 1,
              isCorresponding: true,
            },
          ],
        },
        files: {
          create: [
            {
              tenantId: publicTenantId,
              kind: 'BLIND_PDF',
              storageKey: `t/${publicTenantId}/blind.pdf`,
              bucket: 'submissions',
              fileName: 'cego.pdf',
              mimeType: 'application/pdf',
              sizeBytes: BigInt(1024),
              checksum: 'a'.repeat(64),
              version: 1,
              isCurrent: true,
              scanStatus: 'CLEAN',
            },
            {
              tenantId: publicTenantId,
              kind: 'CAMERA_READY',
              storageKey: `t/${publicTenantId}/camera.pdf`,
              bucket: 'submissions',
              fileName: 'versao-final.pdf',
              mimeType: 'application/pdf',
              sizeBytes: BigInt(2048),
              checksum: 'b'.repeat(64),
              version: 1,
              isCurrent: true,
              scanStatus: 'SKIPPED',
            },
          ],
        },
      },
    });

    await tx.submission.create({
      data: {
        id: rejectedSubId,
        tenantId: publicTenantId,
        eventId: publicEventId,
        trackId,
        submittedById: authorUserId,
        protocol: `2026-R${RUN.slice(0, 3).toUpperCase()}`,
        title: 'Trabalho rejeitado fora dos anais',
        abstract: 'Não deve ser importado.',
        keywords: ['Teste'],
        status: 'REJECTED',
      },
    });
  });

  await withTenant(privateTenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: privateEventId,
        tenantId: privateTenantId,
        slug: `privado-${RUN}`,
        title: 'Encontro Interno',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-10-10T12:00:00Z'),
        endsAt: new Date('2026-10-11T20:00:00Z'),
        timezone: 'America/Bahia',
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [publicTenantId, privateTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { id: authorUserId } });
});

describe('fluxo real de anais no PostgreSQL sob RLS (FASE 111)', () => {
  it('autoriza pós-aceite e bloqueia upload de BLIND_PDF após ACCEPTED', async () => {
    const perm = await recordProceedingsPermission({
      tenantId: publicTenantId,
      submissionId: acceptedSubId,
      userId: authorUserId,
      accepted: true,
    });
    expect(perm.ok).toBe(true);

    const blockedBlind = await requestUpload({
      tenantId: publicTenantId,
      submissionId: acceptedSubId,
      userId: authorUserId,
      kind: 'BLIND_PDF',
      fileName: 'novo-cego.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      checksum: 'c'.repeat(64),
      magicBytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
    });
    expect(blockedBlind.ok).toBe(false);
    if (!blockedBlind.ok) {
      expect(blockedBlind.code).toBe('NOT_EDITABLE');
    }
  });

  it('importa só ACCEPTED, recusa BLIND_PDF na entrada, congela snapshot ao publicar e isola via RLS', async () => {
    const saved = await upsertProceedingsVolume({
      tenantId: publicTenantId,
      eventId: publicEventId,
      userId: authorUserId,
      title: 'Anais do Congresso de Computação 2026',
      editionYear: 2026,
      issn: '2595-9999',
      editors: 'Comitê Editorial',
    });
    expect(saved.ok).toBe(true);

    const imported = await importAcceptedSubmissionsToProceedings({
      tenantId: publicTenantId,
      eventId: publicEventId,
      userId: authorUserId,
    });
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.importedCount).toBe(1);
    }

    const adminOverview = await getAdminProceedingsOverview(publicTenantId, publicEventId);
    expect(adminOverview?.entries).toHaveLength(1);
    const entry = adminOverview!.entries[0]!;
    expect(entry.publicFileKind).toBe('CAMERA_READY');
    expect(entry.availableFiles.map((f) => f.kind)).toEqual(['CAMERA_READY']);

    const blindAttempt = await updateProceedingsEntry({
      tenantId: publicTenantId,
      eventId: publicEventId,
      entryId: entry.id,
      userId: authorUserId,
      displayOrder: 1,
      includeInProceedings: true,
      publicFileKind: 'BLIND_PDF',
    });
    expect(blindAttempt.ok).toBe(false);
    if (!blindAttempt.ok) {
      expect(blindAttempt.code).toBe('FORBIDDEN_FILE_KIND');
    }

    const updated = await updateProceedingsEntry({
      tenantId: publicTenantId,
      eventId: publicEventId,
      entryId: entry.id,
      userId: authorUserId,
      displayOrder: 1,
      includeInProceedings: true,
      sectionName: 'Sistemas Distribuídos',
      pageStart: 1,
      pageEnd: 12,
      externalDoi: 'https://doi.org/10.5281/zenodo.555444',
      publicFileKind: 'CAMERA_READY',
    });
    expect(updated.ok).toBe(true);

    // Antes de publicar, vitrine pública retorna null.
    const beforePub = await getPublicProceedingsByEventSlug({
      tenantId: publicTenantId,
      tenantSlug: SLUG_PUBLICA,
      tenantName: 'Instituto Aberto de Pesquisa',
      eventSlug: `evento-anais-${RUN}`,
    });
    expect(beforePub).toBeNull();

    const published = await publishProceedingsVolume({
      tenantId: publicTenantId,
      eventId: publicEventId,
      userId: authorUserId,
    });
    expect(published.ok).toBe(true);

    // RLS: outra instituição não enxerga nada deste evento.
    const crossTenant = await getAdminProceedingsOverview(privateTenantId, publicEventId);
    expect(crossTenant).toBeNull();

    // Vitrine pública enxerga o trabalho sanitizado e com ORCID, sem email/finalScore/blindSnapshot.
    const pubVolume = await getPublicProceedingsByEventSlug({
      tenantId: publicTenantId,
      tenantSlug: SLUG_PUBLICA,
      tenantName: 'Instituto Aberto de Pesquisa',
      eventSlug: `evento-anais-${RUN}`,
    });
    expect(pubVolume?.entries).toHaveLength(1);
    const pubWork = await getPublicProceedingsWork({
      tenantId: publicTenantId,
      tenantSlug: SLUG_PUBLICA,
      tenantName: 'Instituto Aberto de Pesquisa',
      eventSlug: `evento-anais-${RUN}`,
      protocol: entry.protocol,
    });
    expect(pubWork?.work.externalDoi).toBe('10.5281/zenodo.555444');
    expect(pubWork?.work.authors[0]?.orcidId).toBe('0000-0002-1111-2222');
    const serialized = JSON.stringify(pubWork);
    expect(serialized).not.toContain('nao-deve-vazar@privado.local');
    expect(serialized).not.toContain('Nota confidencial');
    expect(serialized).not.toContain('reviewerSecret');

    // PDF resolve para camera-ready (não cego).
    const pdf = await resolvePublicProceedingsPdf({
      tenantId: publicTenantId,
      eventSlug: `evento-anais-${RUN}`,
      protocol: entry.protocol,
    });
    expect(pdf.ok).toBe(true);
    if (pdf.ok) {
      expect(pdf.fileName).toBe('versao-final.pdf');
    }

    // Sitemap e OAI global enxergam apenas instituições públicas (nunca privada).
    const sitemap = await listPublicSitemapEntries();
    expect(sitemap.some((item) => item.url.includes(`/eventos/evento-anais-${RUN}/anais`))).toBe(true);
    expect(sitemap.some((item) => item.url.includes(`/eventos/privado-${RUN}`))).toBe(false);

    const oai = await loadGlobalOaiRepositoryData();
    expect(oai.records.some((r) => r.identifier.endsWith(entry.protocol))).toBe(true);

    // Despublicar remove imediatamente da vitrine pública.
    const unpub = await unpublishProceedingsVolume({
      tenantId: publicTenantId,
      eventId: publicEventId,
      userId: authorUserId,
    });
    expect(unpub.ok).toBe(true);

    const afterUnpub = await getPublicProceedingsByEventSlug({
      tenantId: publicTenantId,
      tenantSlug: SLUG_PUBLICA,
      tenantName: 'Instituto Aberto de Pesquisa',
      eventSlug: `evento-anais-${RUN}`,
    });
    expect(afterUnpub).toBeNull();
  });
});
