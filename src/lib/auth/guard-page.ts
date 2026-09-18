import { redirect } from 'next/navigation';

import { getRequestContext } from '@/lib/auth/session';
import { can, holdsPermission } from '@/domain/rbac/authorization';
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

/**
 * Guarda de uma tela PESSOAL, em que o conjunto de alvos é definido pela POSSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO BASTA `requirePagePermission` (FASE 25)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O portal do palestrante lista as atividades que ELE ministra. O papel pode ter sido
 *  concedido por ATIVIDADE (o padrão que a plataforma recomenda para palestrante) ou
 *  por EVENTO, e `can()` com um alvo fixo exigiria um `activityId` que a tela ainda não
 *  tem — a lista é justamente o que se quer descobrir.
 *
 *  Então a pergunta aqui é "esta pessoa é palestrante em algum lugar?", e a resposta
 *  usa `holdsPermission`. Isso NÃO abre dado nenhum: cada consulta do painel filtra por
 *  `userId` e cada escrita reconfere a posse com o alvo exato. Sem essa separação, a
 *  alternativa seria exigir papel no escopo de tenant — e o convidado de um minicurso
 *  (que é o caso normal) ficaria sem portal.
 *
 *  `fallbackPath` é o destino de quem não tem o papel — de propósito uma tela neutra,
 *  para não revelar a existência de um painel a quem não participa dele.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `allowWhen` — A SEGUNDA PORTA (revisão da FASE 25)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Há telas pessoais cujo acesso não depende só do papel: o portal do palestrante
 *  precisa abrir para quem foi CONVIDADO e ainda não aceitou — e o papel `SPEAKER` só
 *  nasce com o aceite. Exigir o papel para chegar ao convite é um impasse: sem aceitar
 *  não há papel, e sem papel não se chega ao convite.
 *
 *  A condição extra não mora aqui: a página passa a REGRA (uma consulta ao domínio
 *  dela), e a guarda só a consulta depois de a permissão falhar. Assim a camada de
 *  autenticação continua sem conhecer palestrante, convite ou qualquer outro módulo.
 */
export async function requirePersonalPage(input: {
  tenantSlug: string;
  permission: Permission;
  fallbackPath?: string;
  /** Condição alternativa de entrada; consultada apenas quando a permissão falta. */
  allowWhen?: (context: {
    tenantId: string;
    userId: string;
    userEmail: string;
  }) => Promise<boolean>;
}): Promise<{ tenantId: string; tenantName: string; userId: string; userEmail: string }> {
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

  const allowed =
    holdsPermission(context.principal, input.permission) ||
    (input.allowWhen
      ? await input.allowWhen({
          tenantId: context.activeTenant.tenantId,
          userId: context.user.id,
          userEmail: context.user.email,
        })
      : false);

  if (!allowed) {
    redirect(tenantPath(input.tenantSlug, input.fallbackPath ?? '/dashboard'));
  }

  return {
    tenantId: context.activeTenant.tenantId,
    tenantName: context.activeTenant.tenantName,
    userId: context.user.id,
    userEmail: context.user.email,
  };
}
