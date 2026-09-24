import { NextResponse } from 'next/server';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { can } from '@/domain/rbac/authorization';
import { getTenantContext } from '@/lib/events/event-repository';
import { getSponsorQrForDownload, listSponsorAccess } from '@/lib/sponsors/sponsor-portal-service';
import { isSponsorQrFormat, sponsorQrFile } from '@/lib/sponsors/sponsor-qr-sheet';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GET /api/t/<slug>/patrocinadores/qr/<qrId>?formato=png|svg   (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PARA QUE SERVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É o arquivo do QR do estande: a organização (ou o patrocinador) baixa, manda
 *  para a gráfica ou imprime na hora e coloca no balcão. A tela mostra a mesma
 *  imagem, mas quem vai produzir a peça precisa do ARQUIVO — e o vetor (SVG) é o
 *  formato que aguenta cartaz sem serrilhar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DOIS PÚBLICOS, UMA IMAGEM — E A MESMA REGRA DO CSV
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a ORGANIZAÇÃO (`sponsor:manage`) baixa o QR de qualquer patrocinador do
 *    evento — é ela quem responde pela peça;
 *  • o PATROCINADOR baixa o QR DO PATROCINADOR DELE, e só com vínculo `ACTIVE`.
 *    O dono é decidido pelo BANCO (`getSponsorQrForDownload` devolve `sponsorId`),
 *    nunca pelo que veio na URL: com o `qrId` escolhendo a autorização, trocar o
 *    identificador entregaria a arte de outra empresa.
 *
 *  Aqui NÃO há contato de participante: o que sai é o código do estande, que está
 *  impresso na parede. Ainda assim a rota exige sessão — o endereço interno e o
 *  código de um QR desativado não precisam circular.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string; qrId: string }> },
) {
  const { tenantSlug, qrId } = await params;
  const formato = new URL(request.url).searchParams.get('formato');

  if (formato !== null && !isSponsorQrFormat(formato)) {
    return NextResponse.json(
      { error: 'Formato inválido. Use "png" ou "svg".' },
      { status: 400 },
    );
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

  const qr = await getSponsorQrForDownload(tenant.tenantId, qrId);

  if (!qr.ok) {
    return NextResponse.json({ error: qr.message }, { status: 404 });
  }

  if (!gerencia) {
    /** O caminho do patrocinador: só o patrocinador DELE, pelo vínculo. */
    const acesso = await listSponsorAccess(tenant.tenantId, user.id);

    if (!acesso.some((link) => link.sponsorId === qr.sponsorId)) {
      return NextResponse.json({ error: 'Permissão negada.' }, { status: 403 });
    }
  }

  const file = await sponsorQrFile({
    tenantSlug,
    code: qr.code,
    format: formato ?? 'png',
  });

  return new NextResponse(typeof file.body === 'string' ? file.body : new Uint8Array(file.body), {
    headers: {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'private, no-store',
    },
  });
}
