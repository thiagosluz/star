/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Sitemap global e OAI-PMH agregado (FASE 111)
 *
 *  Descobre instituições públicas ATIVAS via `systemClient()` (sem depender de
 *  `adminPrisma`) e agrega as leituras de cada instituição dentro de `withTenant`,
 *  preservando a RLS em 100% das consultas aos eventos e anais.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { systemClient } from '@/lib/db/tenant-client';
import { publicBaseUrl } from '@/lib/public-url';
import { tenantPath } from '@/domain/tenancy/resolution';
import { loadTenantPublishedProceedingsForIndexing } from '@/lib/proceedings/proceedings-service';
import type { OaiRecordDescriptor, OaiSetDescriptor } from '@/domain/proceedings/indexing-rules';

export interface PublicSitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

async function listActivePublicTenants() {
  return systemClient().tenant.findMany({
    where: {
      status: 'ACTIVE',
      isPublic: true,
      deletedAt: null,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      updatedAt: true,
    },
    take: 500,
  });
}

export async function listPublicSitemapEntries(): Promise<PublicSitemapEntry[]> {
  const baseUrl = publicBaseUrl();
  const entries: PublicSitemapEntry[] = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/privacidade`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/termos`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/acessibilidade`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
  ];

  const tenants = await listActivePublicTenants();

  for (const tenant of tenants) {
    entries.push({
      url: `${baseUrl}${tenantPath(tenant.slug, '')}`,
      lastModified: tenant.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.7,
    });

    const indexed = await loadTenantPublishedProceedingsForIndexing({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    });

    for (const ev of indexed.publicEvents) {
      entries.push({
        url: `${baseUrl}${tenantPath(tenant.slug, `/eventos/${ev.slug}`)}`,
        lastModified: ev.updatedAt,
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }

    for (const vol of indexed.publishedVolumes) {
      entries.push({
        url: `${baseUrl}${tenantPath(tenant.slug, `/eventos/${vol.eventSlug}/anais`)}`,
        lastModified: vol.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.9,
      });
    }

    for (const record of indexed.records) {
      const workUrl = record.identifiers.find((id) => id.startsWith('http'));
      if (!workUrl) continue;
      entries.push({
        url: workUrl,
        lastModified: new Date(record.datestamp),
        changeFrequency: 'monthly',
        priority: 0.9,
      });
    }
  }

  return entries;
}

export async function loadGlobalOaiRepositoryData(): Promise<{
  repositoryName: string;
  adminEmail: string;
  earliestDatestamp: string;
  sets: OaiSetDescriptor[];
  records: OaiRecordDescriptor[];
}> {
  const baseHost = new URL(publicBaseUrl()).hostname;
  const tenants = await listActivePublicTenants();

  const sets: OaiSetDescriptor[] = [];
  const records: OaiRecordDescriptor[] = [];

  for (const tenant of tenants) {
    const indexed = await loadTenantPublishedProceedingsForIndexing({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    });
    sets.push(...indexed.sets);
    records.push(...indexed.records);
  }

  const earliest =
    records
      .map((r) => r.datestamp)
      .sort()[0] ?? '2025-01-01T00:00:00Z';

  return {
    repositoryName: 'Koveno — Diretório Aberto de Anais Científicos',
    adminEmail: `proceedings@${baseHost}`,
    earliestDatestamp: earliest,
    sets,
    records,
  };
}
