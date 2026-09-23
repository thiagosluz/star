import { NextResponse } from 'next/server';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { renderBadgeLabelSheetPdf } from '@/lib/credentials/badge-renderer';
import { badgeFileName, prepareBadgePrint } from '@/lib/events/badge-print-service';
import {
  buildBadgeZplBatch,
  labelLayoutFromParams,
  thermalConfigFromParams,
} from '@/domain/events/badge-print-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  IMPRESSÃO DE CRACHÁS EM ETIQUETA E NA TÉRMICA (FASE 37)
 *  `GET /api/t/<slug>/credenciamento/crachas/impressao?eventId=<id>
 *       &formato=etiquetas|zpl [&userIds=a,b,c] [&<medidas>]`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA SÓ PARA OS DOIS FORMATOS NOVOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A folha A4 (`crachas/folha`) é o caminho de quem não tem impressora de etiqueta, e
 *  ela já existia: mexer no endereço dela quebraria o que a fase anterior entregou. As
 *  duas saídas NOVAS — etiqueta adesiva e ZPL — compartilham a mesma preparação (quais
 *  crachás são válidos, o que marcar como impresso) e vivem aqui, escolhidas por
 *  `formato`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GEOMETRIA VEM DA QUERY, COM PADRÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Milímetros de folha e de etiqueta variam por modelo e por lote, e um número fixo no
 *  código estaria errado para quase todo mundo. O padrão é 3 × 8 de 63,5 × 33,9 mm em A4
 *  (adesiva) e 203 dpi com 100 × 50 mm (térmica); quem tem outra folha ou outro rolo
 *  passa os números na URL — e a tela manda os que o operador digitou.
 *
 *  Medida incoerente é RECUSADA com a mensagem do que não cabe, em vez de gerar um
 *  arquivo que sai torto na primeira folha gasta.
 *
 *  A autorização é a mesma da área de crachás (`attendance:manage`, aceitando escopo de
 *  EVENTO). Nos dois formatos o lote é marcado como impresso — o ZPL inclusive: ele É a
 *  impressão, e quem manda o arquivo para a térmica não quer o crachá marcado como
 *  "não impresso" na tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const FORMATS = ['etiquetas', 'zpl'] as const;
type PrintFormat = (typeof FORMATS)[number];

function isPrintFormat(value: string): value is PrintFormat {
  return (FORMATS as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId') ?? '';
  const format = url.searchParams.get('formato') ?? '';

  if (eventId.length === 0) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_INPUT', message: 'Informe o evento da impressão.' },
      { status: 400 },
    );
  }

  if (!isPrintFormat(format)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_INPUT',
        message: `Formato desconhecido: use ${FORMATS.join(' ou ')}.`,
      },
      { status: 400 },
    );
  }

  /**
   * A geometria é validada ANTES da autorização? Não: erro de forma não pode revelar se
   * o evento existe para quem não tem permissão. A ordem é autorizar, depois validar.
   */
  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.state.code, message: auth.state.message },
      { status: 403 },
    );
  }

  const layoutResult = format === 'etiquetas' ? labelLayoutFromParams(url.searchParams) : null;
  if (layoutResult && !layoutResult.ok) {
    return NextResponse.json(
      { ok: false, code: layoutResult.code, message: layoutResult.message },
      { status: 400 },
    );
  }

  const thermalResult = format === 'zpl' ? thermalConfigFromParams(url.searchParams) : null;
  if (thermalResult && !thermalResult.ok) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_INPUT', message: thermalResult.message },
      { status: 400 },
    );
  }

  const userIds = (url.searchParams.get('userIds') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const prepared = await prepareBadgePrint({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    userIds,
  });

  if (!prepared.ok) {
    return NextResponse.json(
      { ok: false, code: prepared.code, message: prepared.message },
      { status: prepared.code === 'NOT_FOUND' ? 404 : 400 },
    );
  }

  const { batch } = prepared;

  if (format === 'zpl') {
    const zpl = buildBadgeZplBatch(
      batch.badges.map((badge) => ({
        name: badge.name,
        code: badge.code,
        eventTitle: batch.eventTitle,
        tenantName: batch.tenantName,
      })),
      thermalResult!.config,
    );

    /**
     * `text/plain` de propósito: o arquivo é texto e o operador pode ABRIR para conferir
     * o que vai sair antes de gastar etiqueta. O `attachment` é o que faz o navegador
     * salvar `.zpl` em vez de tentar renderizar.
     */
    return new Response(zpl, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${badgeFileName(batch.eventSlug, 'zpl')}"`,
        'cache-control': 'no-store',
        'x-crachas-no-lote': String(batch.badges.length),
      },
    });
  }

  const pdf = renderBadgeLabelSheetPdf({
    tenantName: batch.tenantName,
    eventTitle: batch.eventTitle,
    generatedAt: new Date(),
    badges: batch.badges,
    layout: layoutResult!.layout,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${badgeFileName(batch.eventSlug, 'pdf')}"`,
      'cache-control': 'no-store',
      'x-crachas-no-lote': String(batch.badges.length),
    },
  });
}
