import { NextResponse } from 'next/server';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { withTenant } from '@/lib/db/tenant-client';
import { listCredentialRoster } from '@/lib/events/credential-service';
import { renderBadgeSheetPdf, type BadgeLabel } from '@/lib/credentials/badge-renderer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FOLHA DE CRACHÁS EM PDF (FASE 31)
 *  `GET /api/t/<slug>/credenciamento/crachas/folha?eventId=<id>[&userIds=a,b,c]`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA, E NÃO UMA SERVER ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Impressão é DOWNLOAD: o navegador precisa abrir o arquivo numa aba nova (e o
 *  monitor precisa poder dar Ctrl+P). Server Action devolve estado para a tela, não
 *  um arquivo — e um `blob` montado no cliente duplicaria o renderizador no navegador.
 * *
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

  const [tenant, event, roster] = await Promise.all([
    withTenant(auth.tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } }),
    ),
    withTenant(auth.tenantId, (tx) =>
      tx.event.findFirstOrThrow({
        where: { id: eventId, tenantId: auth.tenantId, deletedAt: null },
        select: { title: true },
      }),
    ),
    listCredentialRoster({ tenantId: auth.tenantId, eventId }),
  ]);

  if (!roster.ok) {
    return NextResponse.json({ ok: false, code: roster.code, message: roster.message }, { status: 400 });
  }

  /**
   * Sem seleção, a folha leva todos os crachás VÁLIDOS — revogado não se imprime (o
   * código não vale mais, e uma etiqueta circulando com ele é um problema no balcão).
   */
  const chosen = roster.entries.filter(
    (entry) =>
      entry.credential !== null &&
      entry.credential.state === 'ACTIVE' &&
      (userIds.length === 0 || userIds.includes(entry.userId)),
  );

  if (chosen.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: 'NO_ELIGIBLE',
        message: 'Nenhum crachá válido para imprimir. Emita os crachás que faltam antes de imprimir a folha.',
      },
      { status: 400 },
    );
  }

  const badges: BadgeLabel[] = chosen.map((entry) => ({
    name: entry.name,
    code: entry.credential!.code,
    subtitle: `${event.title}${entry.registrations.length > 0 ? ` · ${entry.registrations.length} inscrição(ões)` : ''}`,
  }));

  const pdf = renderBadgeSheetPdf({
    tenantName: tenant.name,
    eventTitle: event.title,
    generatedAt: new Date(),
    badges,
  });

  /**
   * A impressão é registrada: quem reimprime uma folha perdida precisa saber que a
   * anterior já saiu — e a lista mostra "impresso" por crachá.
   */
  const credentialIds = chosen.map((entry) => entry.credential!.id);

  await withTenant(auth.tenantId, (tx) =>
    tx.eventCredential.updateMany({
      where: { tenantId: auth.tenantId, id: { in: credentialIds } },
      data: { printedAt: new Date(), printedById: auth.userId },
    }),
  );

  const fileName = `crachas-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
