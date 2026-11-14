import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import { resolvePublicProceedingsPdf } from '@/lib/proceedings/proceedings-service';
import { getObjectStream, sanitizeFileName } from '@/lib/storage/s3-client';
import { logger } from '@/lib/observability/logger';
import { errorMessage } from '@/lib/db/prisma-errors';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; eventSlug: string; protocol: string }> },
) {
  const { tenantSlug, eventSlug, protocol } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Instituição não encontrada.' }, { status: 404 });
  }

  const resolved = await resolvePublicProceedingsPdf({
    tenantId: tenant.tenantId,
    eventSlug,
    protocol,
  });

  if (!resolved.ok) {
    const status = resolved.reason === 'NOT_FOUND' ? 404 : 403;
    return NextResponse.json({ error: resolved.message }, { status });
  }

  try {
    const nodeStream = await getObjectStream(resolved.bucket, resolved.storageKey);
    const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream;
    const safeName = sanitizeFileName(resolved.fileName || `${protocol}.pdf`);

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': resolved.mimeType || 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Content-Length': String(resolved.sizeBytes),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    logger.error(`[proceedings-pdf] falha ao transmitir PDF ${protocol}: ${errorMessage(error)}`);
    return NextResponse.json({ error: 'Não foi possível ler o PDF no armazenamento.' }, { status: 500 });
  }
}
