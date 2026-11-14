import { NextRequest, NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import { loadEventOaiRepositoryData } from '@/lib/proceedings/proceedings-service';
import { buildOaiPmhResponseXml } from '@/domain/proceedings/indexing-rules';
import { publicBaseUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; eventSlug: string }> },
) {
  const { tenantSlug, eventSlug } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Instituição não encontrada.' }, { status: 404 });
  }

  const repo = await loadEventOaiRepositoryData({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    eventSlug,
  });

  if (!repo) {
    return NextResponse.json({ error: 'Volume de anais não encontrado ou não publicado.' }, { status: 404 });
  }

  const requestUrl = `${publicBaseUrl()}/api/t/${tenant.slug}/eventos/${eventSlug}/oai`;
  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const xml = buildOaiPmhResponseXml({
    requestUrl,
    searchParams,
    repositoryName: repo.repositoryName,
    adminEmail: repo.adminEmail,
    earliestDatestamp: repo.earliestDatestamp,
    sets: repo.sets,
    records: repo.records,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
