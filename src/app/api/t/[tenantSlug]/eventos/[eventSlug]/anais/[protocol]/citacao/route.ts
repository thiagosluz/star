import { NextRequest, NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import { getPublicProceedingsWork } from '@/lib/proceedings/proceedings-service';
import { formatBibtexCitation, formatRisCitation } from '@/domain/proceedings/citation-rules';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; eventSlug: string; protocol: string }> },
) {
  const { tenantSlug, eventSlug, protocol } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Instituição não encontrada.' }, { status: 404 });
  }

  const data = await getPublicProceedingsWork({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    eventSlug,
    protocol,
  });

  if (!data) {
    return NextResponse.json({ error: 'Trabalho não encontrado nos anais.' }, { status: 404 });
  }

  const rawFormat = request.nextUrl.searchParams.get('formato')?.toLowerCase();
  const isRis = rawFormat === 'ris';

  const body = isRis
    ? formatRisCitation(data.work, data.volume)
    : formatBibtexCitation(data.work, data.volume);
  const ext = isRis ? 'ris' : 'bib';
  const mimeType = isRis
    ? 'application/x-research-info-systems; charset=utf-8'
    : 'application/x-bibtex; charset=utf-8';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="citacao-${data.work.protocol}.${ext}"`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
