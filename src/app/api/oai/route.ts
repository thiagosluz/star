import { NextRequest, NextResponse } from 'next/server';

import { loadGlobalOaiRepositoryData } from '@/lib/proceedings/indexing-service';
import { buildOaiPmhResponseXml } from '@/domain/proceedings/indexing-rules';
import { publicBaseUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const repo = await loadGlobalOaiRepositoryData();
  const requestUrl = `${publicBaseUrl()}/api/oai`;

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
