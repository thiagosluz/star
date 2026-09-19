import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MailCheck, ShieldAlert, ShieldCheck, UserRoundPlus } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { findInvitationByToken } from '@/lib/communication/invitation-service';
import { invitationConsequence } from '@/domain/communication/invitation-rules';
import { normalizeEmailAddress } from '@/domain/communication/email-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { AcceptInvitationForm } from '@/components/communication/accept-invitation-form';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ACEITE DO CONVITE DE EQUIPE — `/t/<slug>/convite?codigo=<TOKEN>` (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA É PÚBLICA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem recebe o convite normalmente AINDA NÃO TEM VÍNCULO com a instituição — e o
 *  shell autenticado de `/t/<slug>/(app)` exige vínculo ativo, redirecionando para
 *  "selecionar instituição". O aceite dentro do painel seria um impasse: sem vínculo
 *  não se chega ao aceite, e sem aceitar não se ganha o vínculo.
 *
 *  A prova aqui é outra: o CÓDIGO (que só existe no e-mail) e o ENDEREÇO da conta
 *  logada precisam ser os do convite. Quem chega deslogado vê os dados do convite e
 *  o caminho para entrar ou criar conta, com o destino preservado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESTADO É CALCULADO NA LEITURA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Convite vencido não é uma linha que alguém marcou: é a passagem do tempo
 *  (`invitationState`). Esta página mostra o estado real — e não oferece o botão de
 *  aceite quando ele não teria efeito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Convite de equipe' };

export default async function MemberInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { tenantSlug } = await params;
  const { codigo } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const token = codigo?.trim() ?? '';
  const invite = token ? await findInvitationByToken({ tenantId: tenant.tenantId, token }) : null;

  const user = await getAuthenticatedUser();
  const here = `${tenantPath(tenantSlug, '/convite')}?codigo=${encodeURIComponent(token)}`;

  const emailMatches =
    Boolean(user) && Boolean(invite) && normalizeEmailAddress(user?.email ?? '') === invite?.email;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide opacity-60">{tenant.name}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <UserRoundPlus className="size-6" aria-hidden />
          Convite para a equipe
        </h1>
        <p className="text-sm opacity-80">
          Este convite dá acesso à operação da instituição no EventFlow. O vínculo é criado no
          momento em que você aceita.
        </p>
      </header>

      {!invite ? (
        <div className="ef-card space-y-3 p-5" data-testid="invitation-not-found">
          <p className="flex items-center gap-2 font-medium">
            <ShieldAlert className="size-4" aria-hidden />
            Convite não encontrado
          </p>
          <p className="text-sm opacity-75">
            O link pode estar incompleto (às vezes o mensageiro corta o endereço) ou ter sido
            substituído por um convite mais recente — nesse caso, só o último vale. Peça um novo
            convite a quem convidou você.
          </p>
          <Link href={tenantPath(tenantSlug, '/eventos')} className="ef-button-outline">
            Ver a programação
          </Link>
        </div>
      ) : (
        <>
          <div className="ef-card space-y-4 p-5" data-testid="invitation-details">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-60">Instituição</dt>
                <dd className="text-sm font-medium">{invite.tenantName}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-60">Papel</dt>
                <dd className="text-sm font-medium" data-testid="invitation-role">
                  {invite.roleLabel}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-60">Convite para</dt>
                <dd className="text-sm font-medium" data-testid="invitation-email">
                  {invite.email}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide opacity-60">Situação</dt>
                <dd className="text-sm font-medium" data-testid="invitation-state">
                  {invite.stateLabel}
                </dd>
              </div>
            </dl>

            <p className="text-sm opacity-75">
              Ao aceitar, você terá {invitationConsequence(invite.role)}.
            </p>

            {invite.message ? (
              <p className="text-sm opacity-80" data-testid="invitation-message">
                “{invite.message}”
                {invite.invitedByName ? (
                  <span className="block text-xs opacity-70">— {invite.invitedByName}</span>
                ) : null}
              </p>
            ) : null}

            <p className="text-xs opacity-70">
              Válido até{' '}
              {invite.expiresAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.
            </p>
          </div>

          {invite.state !== 'PENDING' ? (
            <div className="ef-card space-y-2 p-5" data-testid="invitation-unusable">
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert className="size-4" aria-hidden />
                {invite.stateLabel}
              </p>
              <p className="text-sm opacity-75">
                {invite.state === 'ACCEPTED'
                  ? 'Este convite já foi aceito: o acesso existe. Entre com a conta que aceitou.'
                  : invite.state === 'EXPIRED'
                    ? 'O prazo deste convite terminou. Peça um novo à instituição — o link tem validade por segurança.'
                    : 'Este convite foi cancelado pela instituição. Peça um novo a quem convidou.'}
              </p>
            </div>
          ) : !user ? (
            <div className="ef-card space-y-3 p-5" data-testid="invitation-auth-required">
              <p className="font-medium">Entre na sua conta para aceitar</p>
              <p className="text-sm opacity-75">
                Use a conta do endereço <strong className="font-medium">{invite.email}</strong> — é
                ele que prova que o convite é seu. Se ainda não tem conta, crie uma agora com este
                e-mail: o convite continua valendo.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href={`/login?redirectTo=${encodeURIComponent(here)}`} className="ef-button">
                  Entrar e aceitar
                </Link>
                <Link
                  href={`/signup?redirectTo=${encodeURIComponent(here)}`}
                  className="ef-button-outline"
                >
                  Criar conta
                </Link>
              </div>
            </div>
          ) : emailMatches ? (
            <div className="ef-card space-y-3 p-5">
              <p className="flex items-center gap-2 text-sm opacity-80">
                <ShieldCheck className="size-4" aria-hidden />
                Convite conferido para <strong className="font-medium">{user.email}</strong>.
              </p>
              <AcceptInvitationForm tenantSlug={tenantSlug} token={token} />
            </div>
          ) : (
            <div className="ef-card space-y-2 p-5" data-testid="invitation-wrong-email">
              <p className="flex items-center gap-2 font-medium">
                <MailCheck className="size-4" aria-hidden />
                Este convite é de outro endereço
              </p>
              <p className="text-sm opacity-75">
                Você está logado como <strong className="font-medium">{user.email}</strong>, e o
                convite foi enviado para <strong className="font-medium">{invite.email}</strong>.
                Saia e entre com aquela conta para aceitar.
              </p>
              <Link href="/login" className="ef-button-outline">
                Trocar de conta
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
