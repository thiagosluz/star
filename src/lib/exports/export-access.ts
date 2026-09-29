/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Quem pode exportar (e baixar) cada tipo de arquivo (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO MORA NA SERVER ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A autorização precisa valer nos DOIS momentos: ao PEDIR a exportação (Server
 *  Action) e ao BAIXAR o arquivo (rota). Se cada uma tivesse a própria cópia da
 *  regra, bastaria a segunda esquecer o vínculo do patrocinador para o arquivo sair
 *  por um caminho que a tela não abriria — e é justamente a rota, e não a tela, que
 *  um atacante chama.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DOIS PÚBLICOS, UMA REGRA POR TIPO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • DIRETÓRIO: quem já vê o diretório (`participant:read`).
 *  • CONTATOS DE PATROCINADOR: quem administra patrocínio (`sponsor:manage`) OU o
 *    PRÓPRIO patrocinador, pelo vínculo ativo com aquele patrocinador (FASE 42) —
 *    sem o vínculo, trocar o `sponsorId` entregaria a lista de outra empresa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { listSponsorAccess } from '@/lib/sponsors/sponsor-portal-service';
import type { ExportKind } from '@/domain/exports/export-rules';

export type ExportAccess =
  | { ok: true; tenantId: string; tenantName: string; userId: string; principal: Principal }
  | { ok: false; status: number; code: string; message: string };

export async function authorizeDataExport(input: {
  tenantSlug: string;
  kind: ExportKind;
  /** Só para `SPONSOR_CONTACTS_CSV`. */
  sponsorId?: string | null;
}): Promise<ExportAccess> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, status: 401, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true, name: true },
  });

  if (!tenant) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  if (input.kind === 'PARTICIPANTS_CSV') {
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
      select: { status: true },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      };
    }

    const principal = await loadPrincipal(user.id, tenant.id, membership.status);

    if (!can(principal, PERMISSIONS.PARTICIPANT_READ, { scope: 'TENANT' })) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        message: 'Permissão negada: participant:read.',
      };
    }

    return { ok: true, tenantId: tenant.id, tenantName: tenant.name, userId: user.id, principal };
  }

  const sponsorId = input.sponsorId ?? '';

  if (!sponsorId) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Informe o patrocinador.' };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  const principal = await loadPrincipal(user.id, tenant.id, membership?.status ?? 'ACTIVE');

  if (can(principal, PERMISSIONS.SPONSOR_MANAGE, { scope: 'TENANT' })) {
    return { ok: true, tenantId: tenant.id, tenantName: tenant.name, userId: user.id, principal };
  }

  /** O caminho do patrocinador: só o patrocinador DELE, pelo vínculo. */
  const access = await listSponsorAccess(tenant.id, user.id);

  if (access.some((link) => link.sponsorId === sponsorId)) {
    return { ok: true, tenantId: tenant.id, tenantName: tenant.name, userId: user.id, principal };
  }

  return {
    ok: false,
    status: 403,
    code: 'FORBIDDEN',
    message: 'Você não tem acesso aos contatos deste patrocinador.',
  };
}
