/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PRÉVIA AO VIVO DO CREDENCIAMENTO (FASE 16, item G7)
 *  `GET /api/events/<eventId>/raffle-live?scope=…&activityId=…&minAttendanceMinutes=…`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO FECHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de sorteio calculava a prévia UMA vez, no carregamento. No palco, com o
 *  credenciamento acontecendo, o organizador via "42 elegíveis" e o número real já
 *  era outro — e a única saída era recarregar a página no meio da apresentação.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE POLLING E NÃO SSE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Server-Sent Events manteria uma conexão aberta por espectador da tela
 *  administrativa, com reconexão, heartbeat e timeout de infraestrutura para
 *  administrar — e o ganho sobre "atualiza a cada 5 segundos" seria imperceptível
 *  para uma contagem que muda quando alguém passa na catraca. A tela DIZ que o
 *  número é amostrado (com o horário), em vez de fingir tempo real.
 *
 *  A consulta é a MESMA da apuração (`previewEligibility`): duas implementações da
 *  contagem divergiriam, e o organizador veria um número na tela e outro no
 *  resultado — exatamente a discrepância que corrói a confiança no sorteio.
 *
 *  Autorização: sessão + vínculo ativo + `event:manage`, como na tela que consome.
 *  A leitura roda sob RLS (`withTenant`), então o recorte de instituição é do banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';

import { adminPrisma } from '@/lib/db/admin-client';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { RAFFLE_SCOPES, type RaffleScope } from '@/domain/raffles/raffle-rules';
import { getLiveEligibility } from '@/lib/raffles/raffle-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message }, { status: 400 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ ok: false, code: 'NOT_AUTHENTICATED' }, { status: 401 });
  }

  const { eventId } = await context.params;
  const url = new URL(request.url);
  const tenantSlug = url.searchParams.get('tenantSlug')?.trim() ?? '';
  const scope = url.searchParams.get('scope') ?? 'EVENT';

  if (!tenantSlug || !(RAFFLE_SCOPES as readonly string[]).includes(scope)) {
    return badRequest('Informe a instituição e um escopo de sorteio válido.');
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' })) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const referenceDateParam = url.searchParams.get('referenceDate');

  const result = await getLiveEligibility({
    tenantId: tenant.id,
    eventId,
    config: {
      scope: scope as RaffleScope,
      referenceDate: referenceDateParam ? new Date(`${referenceDateParam}T12:00:00.000Z`) : null,
      activityId: url.searchParams.get('activityId') || null,
      minAttendanceMinutes: Number(url.searchParams.get('minAttendanceMinutes') ?? 0) || 0,
      winnersCount: 1,
      alternatesCount: 0,
      weightByMinutes: false,
      allowPriorEventWinners: url.searchParams.get('allowPriorEventWinners') === 'true',
    },
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, code: result.code, message: result.message }, { status: 200 });
  }

  return NextResponse.json(
    {
      ok: true,
      eligibleCount: result.eligibleCount,
      inspectedAttendances: result.inspectedAttendances,
      lastCheckInAt: result.lastCheckInAt?.toISOString() ?? null,
      sampledAt: result.sampledAt.toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
