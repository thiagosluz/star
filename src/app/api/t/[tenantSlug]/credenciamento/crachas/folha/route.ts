import { NextResponse } from 'next/server';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { renderBadgeSheetPdf } from '@/lib/credentials/badge-renderer';
import { badgeFileName, prepareBadgePrint } from '@/lib/events/badge-print-service';

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
    return NextResponse.json(
      { ok: false, code: 'INVALID_INPUT', message: 'Informe o evento da folha de crachás.' },
      { status: 400 },
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
    return NextResponse.json({ ok: false, code: auth.state.code, message: auth.state.message }, { status: 403 });
  }

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

  const pdf = renderBadgeSheetPdf({
    tenantName: prepared.batch.tenantName,
    eventTitle: prepared.batch.eventTitle,
    generatedAt: new Date(),
    badges: prepared.batch.badges,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${badgeFileName(prepared.batch.eventSlug, 'pdf')}"`,
      'cache-control': 'no-store',
    },
  });
}
