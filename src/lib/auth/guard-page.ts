import { redirect } from 'next/navigation';

import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import type { Permission } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Guarda de autorização para PÁGINAS
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO EXISTE (E POR QUE NÃO BASTA O MENU)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cabeçalho esconde links que o usuário não pode usar, mas esconder link não é
 *  autorização: quem digitar a URL entra. Sem uma checagem na página, um
 *  participante abriria o painel do comitê e leria a fila de avaliação inteira —
 *  inclusive títulos e resumos de trabalhos de terceiros.
 *
 *  A decisão acontece aqui, no servidor, ANTES de qualquer consulta de dados.
 *  Negar depois de carregar a lista seria negar com o dado já na memória.
 *
 *  O `Principal` já vem resolvido em `getRequestContext()` (sob RLS), então a
 *  guarda não paga uma segunda ida ao banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function requirePagePermission(input: {
  tenantSlug: string;
  permission: Permission;
  /**
   * Caminho interno para onde voltar quando a permissão falta. O padrão é o
   * painel: negar com um redirecionamento evita revelar a existência de dados
   * que o usuário não pode ver.
   */
  fallbackPath?: string;
}): Promise<{ tenantId: string; tenantName: string; userId: string }> {
  const context = await getRequestContext();

  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(input.tenantSlug, input.fallbackPath ?? '/dashboard'),
      )}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== input.tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  /**
   * Permissão `:own` exige posse — e a posse, numa página PESSOAL, é o próprio
   * usuário da sessão. Sem passar `ownerId`, `can()` nega (fail-closed) e todas
   * as páginas "minhas" ficariam inacessíveis.
   */
  const ownership = input.permission.endsWith(':own')
    ? { ownerId: context.user.id }
    : undefined;

  const allowed = can(context.principal, input.permission, { scope: 'TENANT' }, ownership);

  if (!allowed) {
    redirect(tenantPath(input.tenantSlug, input.fallbackPath ?? '/dashboard'));
  }

  return {
    tenantId: context.activeTenant.tenantId,
    tenantName: context.activeTenant.tenantName,
    userId: context.user.id,
  };
}
