import { redirect } from 'next/navigation';

import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import type { Permission } from '@/domain/rbac/permissions';
import type { RoleScope } from '@/domain/rbac/permissions';
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
  /**
   * Escopos que autorizam a página. O padrão é `['TENANT']`.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ISTO EXISTE (FASE 12, item I7)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A tela de credenciamento exigia permissão de escopo TENANT — e o próprio seed
   *  de demonstração concede `STAFF` por EVENTO (a equipe do dia, com validade). O
   *  resultado era contraditório: a plataforma recomendava um padrão de concessão e
   *  redirecionava ao painel quem o seguia.
   *
   *  Aceitar `EVENT` fecha essa distância. A página que optar por isso passa a ser
   *  responsável por LIMITAR o que mostra — o escopo mais estreito não pode virar
   *  acesso ao evento alheio.
   */
  allowedScopes?: readonly RoleScope[];
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

  const allowed = (input.allowedScopes ?? ['TENANT']).some((scope) =>
    can(context.principal, input.permission, { scope }, ownership),
  );

  if (!allowed) {
    redirect(tenantPath(input.tenantSlug, input.fallbackPath ?? '/dashboard'));
  }

  return {
    tenantId: context.activeTenant.tenantId,
    tenantName: context.activeTenant.tenantName,
    userId: context.user.id,
  };
}
