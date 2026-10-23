import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { renderBadgeSheetPdf } from '@/lib/credentials/badge-renderer';
import { badgeFileName, prepareBadgePrint } from '@/lib/events/badge-print-service';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FOLHA DE CRACHÁS EM PDF (FASE 31) — A4, para recortar
 *  `GET /api/t/<slug>/credenciamento/crachas/folha?eventId=<id>[&userIds=a,b,c]`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA, E NÃO UMA SERVER ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Impressão é DOWNLOAD: o navegador precisa abrir o arquivo numa aba nova (e o
 *  monitor precisa poder dar Ctrl+P). Server Action devolve estado para a tela, não
 *  um arquivo — e um `blob` montado no cliente duplicaria o renderizador no navegador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ROTA NÃO FICA SOB `/eventos/<algo>/` (e o `eventId` vem na query)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O Next.js NÃO aceita dois nomes diferentes para o mesmo nível dinâmico: já existe
 *  `/api/t/[tenantSlug]/eventos/[eventSlug]/...` (o ao vivo do palco), e um
 *  `[eventId]` no mesmo nível derruba o BUILD ("You cannot use different slug names
 *  for the same dynamic path"). O caminho fica no namespace da própria tela
 *  (`/credenciamento/crachas`), e o evento vem por parâmetro — validado no banco.
 *
 *  A autorização é a mesma da área de crachás (`attendance:manage`, aceitando o
 *  escopo de EVENTO), e a leitura passa por `withTenant`: a folha de uma instituição
 *  não sai por engano para outra.
 *
 *  O QUE A ETIQUETA TEM: QR Code (com o código), o CÓDIGO por extenso e o NOME. Nada
 *  de dado pessoal além do nome — o QR carrega só o código.
 *
 *  Desde a FASE 37 a preparação do lote (quais crachás são válidos e a marcação de
 *  impresso) vive em `prepareBadgePrint`, compartilhada com as etiquetas adesivas e com
 *  o arquivo ZPL: três saídas de impressão, UMA regra.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId') ?? '';

  if (eventId.length === 0) {
    return tenantApiError(400, 'INVALID_INPUT', 'Informe o evento da folha de crachás.');
  }

  /**
   * ─── POR QUE 400, E NÃO 404, NO `?eventId=` MALFORMADO (FASE 76) ────────────
   * Esta rota NÃO tem o evento no caminho: o endereço é `/crachas/folha` e o evento
   * é um parâmetro OBRIGATÓRIO da operação (de quem é a folha). Sem ele a rota já
   * responde 400 ("Informe o evento..."); um texto que não é uuid é a MESMA classe de
   * erro — pedido malformado, não recurso ausente. Um 404 aqui colidiria com o 404
   * de "evento não encontrado" (uuid bem formado e inexistente) e diria à tela que a
   * folha não existe, quando o problema é o valor enviado. Sem esta linha, o id
   * torto chegava ao Prisma e a rota respondia 500 sem corpo.
   */
  if (!isUuid(eventId)) {
    return tenantApiError(
      400,
      'INVALID_INPUT',
      'O evento da folha de crachás não é um identificador válido.',
    );
  }

  const userIds = (url.searchParams.get('userIds') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });

  if (!auth.ok) {
    return tenantApiError(403, auth.state.code ?? 'FORBIDDEN', auth.state.message ?? 'Permissão negada.');
  }

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

  const pdf = renderBadgeSheetPdf({
    tenantName: prepared.batch.tenantName,
    eventTitle: prepared.batch.eventTitle,
    generatedAt: new Date(),
    badges: prepared.batch.badges,
    theme: prepared.batch.theme,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${badgeFileName(prepared.batch.eventSlug, 'pdf')}"`,
      'cache-control': 'no-store',
    },
  });
}
