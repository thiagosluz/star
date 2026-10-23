import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { renderBadgeLabelSheetPdf } from '@/lib/credentials/badge-renderer';
import { badgeFileName, prepareBadgePrint } from '@/lib/events/badge-print-service';
import {
  buildBadgeZplBatch,
  labelLayoutFromParams,
  thermalConfigFromParams,
} from '@/domain/events/badge-print-rules';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

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
    return tenantApiError(400, 'INVALID_INPUT', 'Informe o evento da impressão.');
  }

  /**
   * ─── MESMA ESCOLHA DA FOLHA: 400 PARA O `?eventId=` MALFORMADO (FASE 76) ─────
   * O evento é parâmetro OBRIGATÓRIO da operação, não o endereço do recurso. A rota
   * já responde 400 quando ele falta; um texto sem forma de uuid é o mesmo pedido
   * malformado, e 400 o distingue do 404 de "evento não encontrado" — que continua
   * vindo de `prepareBadgePrint` para um uuid bem formado e inexistente. As duas
   * rotas de crachá (`folha` e `impressao`) usam o MESMO status, de propósito.
   */
  if (!isUuid(eventId)) {
    return tenantApiError(
      400,
      'INVALID_INPUT',
      'O evento da impressão não é um identificador válido.',
    );
  }

  if (!isPrintFormat(format)) {
    return tenantApiError(
      400,
      'INVALID_INPUT',
      `Formato desconhecido: use ${FORMATS.join(' ou ')}.`,
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
    return tenantApiError(403, auth.state.code ?? 'FORBIDDEN', auth.state.message ?? 'Permissão negada.');
  }

  const layoutResult = format === 'etiquetas' ? labelLayoutFromParams(url.searchParams) : null;
  if (layoutResult && !layoutResult.ok) {
    return tenantApiError(400, layoutResult.code, layoutResult.message);
  }

  const thermalResult = format === 'zpl' ? thermalConfigFromParams(url.searchParams) : null;
  if (thermalResult && !thermalResult.ok) {
    return tenantApiError(400, 'INVALID_INPUT', thermalResult.message);
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
    return tenantApiError(
      prepared.code === 'NOT_FOUND' ? 404 : 400,
      prepared.code,
      prepared.message,
    );
  }

  const { batch } = prepared;

  if (format === 'zpl') {
    const zpl = buildBadgeZplBatch(
      batch.badges.map((badge) => ({
        name: badge.name,
        code: badge.code,
        category: badge.category ?? null,
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
    theme: batch.theme,
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
