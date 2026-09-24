import { NextResponse } from 'next/server';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { can } from '@/domain/rbac/authorization';
import { listSponsorAccess, listSponsorLeads } from '@/lib/sponsors/sponsor-portal-service';
import { getTenantContext } from '@/lib/events/event-repository';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GET /api/t/<slug>/patrocinadores/contatos?sponsorId=<id>   (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DOIS PÚBLICOS, UM ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a ORGANIZAÇÃO (`sponsor:manage`) exporta os contatos de qualquer patrocinador
 *    do evento — é ela quem responde pelo dado;
 *  • o PATROCINADOR exporta os contatos DO PATROCINADOR DELE, e só se estiver
 *    vinculado a ele (vínculo `ACTIVE`). Sem essa checagem, trocar o `sponsorId` na
 *    URL entregaria a lista de outra empresa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SAI NO ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nome, e-mail, evento, QR, data da autorização e vencimento — SÓ dos contatos
 *  VIGENTES. Contato revogado ou vencido fica de fora: o arquivo é uma cópia do
 *  que o patrocinador já podia ver na tela, e não uma segunda porta para o dado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await params;
  const sponsorId = new URL(request.url).searchParams.get('sponsorId');

  if (!sponsorId) {
    return NextResponse.json({ error: 'Informe o patrocinador.' }, { status: 400 });
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Instituição não encontrada.' }, { status: 404 });
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.tenantId, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Sem vínculo ativo com a instituição.' }, { status: 403 });
  }

  const principal = await loadPrincipal(user.id, tenant.tenantId, membership.status);
  const gerencia = can(principal, PERMISSIONS.SPONSOR_MANAGE, { scope: 'TENANT' });

  if (!gerencia) {
    /** O caminho do patrocinador: só o patrocinador DELE, pelo vínculo. */
    const acesso = await listSponsorAccess(tenant.tenantId, user.id);

    if (!acesso.some((link) => link.sponsorId === sponsorId)) {
      return NextResponse.json({ error: 'Permissão negada.' }, { status: 403 });
    }
  }

  const sponsor = await adminPrisma.sponsor.findFirst({
    where: { id: sponsorId, tenantId: tenant.tenantId, deletedAt: null },
    select: { name: true },
  });

  if (!sponsor) {
    return NextResponse.json({ error: 'Patrocinador não encontrado.' }, { status: 404 });
  }

  const leads = await listSponsorLeads(tenant.tenantId, sponsorId);

  const header = ['Nome', 'E-mail', 'Evento', 'QR', 'Autorizado em', 'Vale até'];
  const linhas = leads.map((lead) => [
    lead.sharedName,
    lead.sharedEmail,
    lead.eventTitle,
    lead.qrLabel,
    lead.consentedAt.toISOString().slice(0, 10),
    lead.expiresAt ? lead.expiresAt.toISOString().slice(0, 10) : '',
  ]);

  /**
   * CSV com `;` (o separador que o Excel em pt-BR abre por padrão) e aspas dobradas
   * nos campos: nome de empresa e rótulo de QR têm vírgula e ponto e vírgula.
   */
  const csv = [header, ...linhas]
    .map((linha) => linha.map((campo) => `"${campo.replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const nomeArquivo = `contatos-${sponsor.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.csv`;

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nomeArquivo}"`,
      'cache-control': 'no-store',
    },
  });
}
