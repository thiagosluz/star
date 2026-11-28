import { NextResponse } from 'next/server';

import {
  buildLayoutFromRows,
  parsePageFormat,
  sampleVariableValues,
  validateLayout,
  type CertificateBackground,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { isUuid } from '@/domain/validation/id-rules';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { guardAction } from '@/lib/auth/guard-action';
import {
  getCertificateTemplate,
  readTemplateBackground,
} from '@/lib/certificates/certificate-template-service';
import { renderCertificateLayoutPdf } from '@/lib/certificates/layout-renderer';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PRÉVIA AO VIVO EM PDF REAL DO ESTÚDIO DE CERTIFICADOS (FASE 133 · ADR-524)
 *  `POST /api/t/<slug>/certificados/previa-pdf`
 *
 *  Renderiza um PDF de amostra usando o MESMO `renderCertificateLayoutPdf` da
 *  emissão real, a partir do rascunho atual do estúdio (sem gravar no banco nem
 *  emitir certificado). Quando `templateId` é informado, a arte de fundo é lida
 *  diretamente do modelo autorizado do tenant — nunca de URL fornecida pelo cliente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
interface PreviewPdfBody {
  page?: unknown;
  elements?: unknown;
  templateId?: unknown;
  variant?: unknown;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.state.code, message: auth.state.message },
      { status: auth.state.code === 'NOT_AUTHENTICATED' ? 401 : 403 },
    );
  }

  let body: PreviewPdfBody;
  try {
    body = (await request.json()) as PreviewPdfBody;
  } catch {
    return tenantApiError(400, 'INVALID_INPUT', 'Corpo JSON inválido para gerar a prévia em PDF.');
  }

  const page = parsePageFormat(typeof body.page === 'string' ? body.page : null);
  if (!page) {
    return tenantApiError(400, 'INVALID_INPUT', 'Formato de página inválido.');
  }

  if (!Array.isArray(body.elements) || body.elements.length === 0) {
    return tenantApiError(400, 'INVALID_INPUT', 'Adicione ao menos um elemento antes de gerar o PDF.');
  }

  const items = body.elements.map((raw) =>
    (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
  );

  let background: CertificateBackground | null = null;
  let backgroundBytes: Uint8Array | null = null;

  if (typeof body.templateId === 'string' && body.templateId.trim().length > 0) {
    const templateId = body.templateId.trim();
    if (!isUuid(templateId)) {
      return tenantApiError(400, 'INVALID_INPUT', 'Identificador do modelo inválido.');
    }

    const template = await getCertificateTemplate(auth.tenantId, templateId);
    if (template?.layout.background) {
      background = template.layout.background;
      backgroundBytes = await readTemplateBackground(template.layout).catch(() => null);
    }
  }

  const layout = buildLayoutFromRows({
    page,
    background,
    ids: items.map((item) => asString(item.id)),
    kinds: items.map((item) => asString(item.kind)),
    texts: items.map((item) => asString(item.text)),
    variables: items.map((item) => asString(item.variable)),
    xMm: items.map((item) => asString(item.xMm, '0')),
    yMm: items.map((item) => asString(item.yMm, '0')),
    widthMm: items.map((item) => asString(item.widthMm, '0')),
    heightMm: items.map((item) => asString(item.heightMm, '0')),
    aligns: items.map((item) => asString(item.align, 'CENTER')),
    fonts: items.map((item) => asString(item.font, 'HELVETICA')),
    sizePt: items.map((item) => asString(item.sizePt, '12')),
    colors: items.map((item) => asString(item.color)),
    lineHeights: items.map((item) => asString(item.lineHeight, '1.35')),
  });

  const validation = validateLayout(layout);
  if (!validation.ok) {
    return tenantApiError(
      400,
      'INVALID_INPUT',
      validation.issues[0]?.message ?? 'O layout possui ajustes pendentes antes de gerar o PDF.',
    );
  }

  const variant: CertificatePreviewVariant = body.variant === 'WORST_CASE' ? 'WORST_CASE' : 'FULL';

  try {
    const pdf = renderCertificateLayoutPdf({
      values: sampleVariableValues(variant),
      layout,
      backgroundBytes,
      issuedAt: new Date(),
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="previa-certificado.pdf"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logger.error(`[certificate-preview-pdf] falha ao renderizar PDF de amostra: ${String(error)}`);
    return tenantApiError(500, 'INTERNAL', 'Não foi possível gerar a prévia em PDF.');
  }
}
