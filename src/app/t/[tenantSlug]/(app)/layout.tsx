import { redirect } from 'next/navigation';

import { getRequestContext, loadPrincipal } from '@/lib/auth/session';
import { lookupTenant } from '@/lib/tenancy/tenant-resolver';
import { hasPendingSpeakerInvite } from '@/lib/speakers/speaker-portal-service';
import { isValidSlug, tenantPath } from '@/domain/tenancy/resolution';
import { AccountBlock } from '@/components/shell/account-block';
import { AppShell } from '@/components/shell/app-shell';
import { buildTenantNav } from '@/components/shell/tenant-nav';
import { VerificationNotice } from '@/components/communication/verification-notice';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Layout de instituição — `/t/[tenantSlug]/*` (FASE 11A: shell com barra lateral)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE É O PONTO DE AUTORIZAÇÃO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O Proxy apenas reescreve a URL e injeta headers; ele NÃO autoriza. Toda a
 *  decisão de acesso acontece aqui e nas Server Actions, perto do dado — que é
 *  exatamente o que a documentação do Next.js recomenda ("optimistic checks with
 *  Proxy", nunca autorização).
 *
 *  Verificações feitas, em ordem:
 *    1. A instituição existe e está ATIVA?
 *    2. Existe sessão autenticada?
 *    3. O usuário tem vínculo ATIVO com esta instituição?
 *    4. O contexto ativo corresponde ao slug da URL?
 *    5. O `Principal` é carregado sob RLS — e é ele que filtra a navegação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  if (!isValidSlug(tenantSlug)) {
    redirect('/404-tenant');
  }

  // ── 1. A instituição existe e está operacional? ────────────────────────────
  const lookup = await lookupTenant({
    kind: 'resolved',
    source: 'path',
    identifier: tenantSlug,
    isCustomDomain: false,
  });

  /**
   * Suspensa ≠ inexistente.
   *
   * A suspensão corta o PAINEL imediatamente — e não só a vitrine: as pessoas da
   * instituição perdem acesso às ferramentas de trabalho enquanto a pendência
   * existir. O motivo vai junto, porque quem abre o painel todos os dias é
   * exatamente quem precisa saber o que aconteceu.
   */
  if (lookup.kind === 'not-operational') {
    redirect(`/instituicao-bloqueada?slug=${encodeURIComponent(tenantSlug)}`);
  }

  if (lookup.kind !== 'ok') {
    redirect('/404-tenant');
  }
  const tenant = lookup.tenant;

  // ── 2. Sessão autenticada ──────────────────────────────────────────────────
  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, '/dashboard'))}`,
    );
  }

  // ── 3. Vínculo ativo com ESTA instituição ──────────────────────────────────
  const membership = context.memberships.find(
    (m) => m.tenantSlug === tenantSlug && m.status === 'ACTIVE',
  );

  if (!membership) {
    redirect('/selecionar-instituicao');
  }

  // ── 4. Contexto ativo precisa bater com a URL ──────────────────────────────
  // Garante que a RLS use o tenant correto nas consultas das páginas filhas.
  if (context.activeTenant?.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  // ── 5. Principal RBAC sob RLS ──────────────────────────────────────────────
  const principal = await loadPrincipal(
    context.user.id,
    tenant.id,
    membership.status,
  );

  return (
    <AppShell
      brand={{ label: 'EventFlow', tagline: 'Gestão de eventos' }}
      context={{
        name: tenant.name,
        detail: `${membership.roles.length > 0 ? membership.roles.join(' · ') : 'Sem papel'} · ${tenant.plan}`,
        logoUrl: tenant.logoUrl,
        href: '/selecionar-instituicao',
        testId: 'active-tenant',
      }}
      navGroups={buildTenantNav({
        tenantSlug,
        principal,
        /**
         * ─────────────────────────────────────────────────────────────────────────────
         *  O CONVITE DE PALESTRANTE TAMBÉM ABRE UM ITEM DE MENU (revisão da FASE 25)
         * ─────────────────────────────────────────────────────────────────────────────
         *  O papel `SPEAKER` nasce com o ACEITE do convite. Sem esta consulta, quem foi
         *  convidado veria o painel sem nenhuma pista de que existe um convite para
         *  ele — o item do menu depende de permissão, e ele ainda não tem nenhuma.
         *
         *  É UMA consulta por render do shell, por igualdade no índice único
         *  (`tenantId`, `email`), e só o booleano atravessa daqui para o menu.
         */
        hasPendingSpeakerInvite: await hasPendingSpeakerInvite({
          tenantId: tenant.id,
          userEmail: context.user.email,
        }),
      })}
      account={
        <AccountBlock
          user={{ name: context.user.name, email: context.user.email }}
          memberships={context.memberships}
          currentSlug={tenantSlug}
        />
      }
    >
      {/**
       * Aviso de endereço não confirmado (FASE 15). Ele vive no shell porque a
       * verificação NÃO bloqueia o login: sem um lugar que apareça sempre, quem cria a
       * conta nunca voltaria para confirmar. O dado vem da sessão — sem consulta extra.
       */}
      {!context.user.emailVerified ? (
        <VerificationNotice
          email={context.user.email}
          redirectTo={tenantPath(tenantSlug, '/dashboard')}
        />
      ) : null}

      {children}
    </AppShell>
  );
}
