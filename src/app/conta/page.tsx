import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, KeyRound, ShieldCheck, Smartphone, UserRound } from 'lucide-react';

import { getCurrentSession } from '@/lib/auth/session';
import { getAccountOverview, readAccountSessions } from '@/lib/auth/account-service';
import { signOutAction } from '@/app/actions/auth-actions';
import {
  changeAccountPasswordAction,
  confirmAccountAvatarUploadAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  removeAccountAvatarAction,
  regenerateBackupCodesAction,
  requestAccountAvatarUploadAction,
  requestEmailChangeAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  setAccountPasswordAction,
  startTwoFactorAction,
  updateAccountProfileAction,
} from '@/app/actions/account-actions';
import {
  AccountAvatarField,
  AccountEmailForm,
  AccountPasswordForm,
  AccountProfileForm,
  AccountSessionsList,
  AccountTwoFactorPanel,
} from '@/components/account/account-forms';
import { VerificationNotice } from '@/components/communication/verification-notice';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';

export const metadata = { title: 'Minha conta' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MINHA CONTA — a área da IDENTIDADE (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA É GLOBAL, E NÃO DENTRO DE UMA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nome, e-mail, senha, segundo fator, foto e sessões são da PESSOA — valem para ela
 *  em qualquer casa, e existem mesmo para quem não tem vínculo nenhum (é o caso de
 *  quem se inscreve num evento público). Uma área por instituição daria à mesma pessoa
 *  várias "contas" diferentes e deixaria de fora justamente quem mais precisa
 *  recuperar a senha. A identidade é global desde a ADR-002; a tela passou a refletir
 *  isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA DIZ SEM ARREDONDAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a foto é pública (a matriz de visibilidade decide se ela APARECE na página);
 *    • os códigos de recuperação aparecem uma vez só;
 *    • o segundo fator só vale depois do código confirmado;
 *    • trocar a senha encerra as outras sessões;
 *    • a foto enviada pela ORGANIZAÇÃO (FASE 46) aparece aqui como foto da conta, e
 *      o palestrante pode trocá-la daqui também.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const session = await getCurrentSession();

  if (!session) {
    redirect('/login?redirectTo=%2Fconta');
  }

  const [account, sessions, params] = await Promise.all([
    getAccountOverview(session.user.id),
    readAccountSessions({ userId: session.user.id, currentToken: session.token }),
    searchParams,
  ]);

  if (!account) {
    redirect('/login');
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-2">
        <Link
          href="/selecionar-instituicao"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Voltar
        </Link>

        <h1 className="flex items-center gap-2 font-display text-headline text-foreground">
          <UserRound className="size-6 text-primary" aria-hidden />
          Minha conta
        </h1>
        <p className="text-sm text-muted-foreground">
          Seus dados de acesso valem em qualquer instituição — e existem mesmo para quem participa
          sem vínculo.
        </p>
      </header>

      {params.email === 'confirmado' ? (
        <p
          className="rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success-strong"
          data-testid="account-email-confirmed"
          role="status"
        >
          E-mail confirmado e atualizado.
        </p>
      ) : null}

      {!account.emailVerified ? (
        <VerificationNotice email={account.email} redirectTo="/conta" />
      ) : null}

      {/* ── Foto e dados ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Foto e dados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <AccountAvatarField
            currentUrl={account.image}
            name={account.name}
            requestAction={requestAccountAvatarUploadAction}
            confirmAction={confirmAccountAvatarUploadAction}
            removeAction={removeAccountAvatarAction}
          />

          <div className="border-t border-border pt-5">
            <AccountProfileForm currentName={account.name} action={updateAccountProfileAction} />
          </div>

          <div className="border-t border-border pt-5">
            <AccountEmailForm
              currentEmail={account.email}
              emailVerified={account.emailVerified}
              action={requestEmailChangeAction}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Senha ───────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden />
            Senha
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AccountPasswordForm
            hasPassword={account.hasPassword}
            changeAction={changeAccountPasswordAction}
            setAction={setAccountPasswordAction}
          />
        </CardContent>
      </Card>

      {/* ── Segundo fator ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            Segundo fator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AccountTwoFactorPanel
            enabled={account.twoFactorEnabled}
            hasPassword={account.hasPassword}
            startAction={startTwoFactorAction}
            confirmAction={confirmTwoFactorAction}
            disableAction={disableTwoFactorAction}
            regenerateAction={regenerateBackupCodesAction}
          />
        </CardContent>
      </Card>

      {/* ── Sessões ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-primary" aria-hidden />
            Dispositivos conectados
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Estas são as sessões ativas da sua conta ({sessions.length}). Encerrar uma sessão
            derruba o acesso daquele dispositivo na hora.
          </p>

          <AccountSessionsList
            sessions={sessions}
            revokeAction={revokeSessionAction}
            revokeOthersAction={revokeOtherSessionsAction}
          />
        </CardContent>
      </Card>

      <footer className="flex flex-wrap items-center justify-between gap-3 pb-6 text-sm">
        {account.publicHandle ? (
          <span className="text-muted-foreground">
            Seu perfil público usa o endereço <code>/u/{account.publicHandle}</code> — a
            visibilidade de cada campo é decidida dentro de cada instituição.
          </span>
        ) : (
          <span className="text-muted-foreground">
            Você ainda não tem perfil público. Ele é criado dentro de uma instituição.
          </span>
        )}

        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm" data-testid="account-sign-out">
            Sair da conta
          </Button>
        </form>
      </footer>
    </main>
  );
}
