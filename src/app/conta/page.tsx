import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Smartphone,
  SunMoon,
  UserRound,
} from 'lucide-react';

import { getCurrentSession } from '@/lib/auth/session';
import { getAccountOverview, readAccountSessions } from '@/lib/auth/account-service';
import { listMyIdentityAudit } from '@/lib/platform/identity-audit-service';
import {
  IDENTITY_AUDIT_TONE_LABELS,
  identityAuditLabel,
  identityAuditTone,
} from '@/domain/identity/identity-audit-rules';
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
import { ThemeChoice } from '@/components/theme/theme-choice';
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

  const [account, sessions, params, security] = await Promise.all([
    getAccountOverview(session.user.id),
    readAccountSessions({ userId: session.user.id, currentToken: session.token }),
    searchParams,
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O HISTÓRICO DE SEGURANÇA É DA PRÓPRIA PESSOA (FASE 49)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A trilha de identidade é global e o SuperAdmin vê tudo; aqui a leitura é por
     *  POSSE — o `userId` vem da sessão, não da URL. Ver o próprio histórico é o que
     *  permite responder "eu não fiz isso" na hora, em vez de abrir um chamado.
     */
    listMyIdentityAudit({ userId: session.user.id, limit: 12 }),
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

      {/* ── Aparência (FASE 61) ─────────────────────────────────────────────── */}
      {/**
        * ───────────────────────────────────────────────────────────────────────────
        *  O TEMA É DESTE NAVEGADOR, E A TELA DIZ ISSO — NÃO É UM DADO DA CONTA
        *  ───────────────────────────────────────────────────────────────────────────
        *  A alternativa descartada foi a coluna no banco. O aviso existe porque a
        *  confusão contrária é a esperada: quem escolhe escuro aqui e abre o
        *  sistema em outra máquina encontra claro, e sem a frase concluiria que a
        *  preferência "não salvou". Ela salvou — no navegador em que foi feita.
        */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SunMoon className="size-4 text-primary" aria-hidden />
            Aparência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            O tema vale para{' '}
            <strong className="font-medium text-foreground">este navegador</strong>, não para a
            sua conta: você pode preferir escuro no celular e claro no computador do trabalho.
            Sem escolha gravada, a plataforma acompanha o tema do seu sistema operacional.
          </p>

          <ThemeChoice variant="account" />
        </CardContent>
      </Card>

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

      {/* ── Histórico de segurança (FASE 49) ──────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="size-4 text-primary" aria-hidden />
            Segurança e acessos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            O que mudou na sua conta e quando — troca de senha, segundo fator, códigos de
            recuperação, troca de e-mail e sessões encerradas. A plataforma guarda o FATO (autor,
            hora e origem); senha, código e semente do aplicativo nunca entram aqui.
          </p>

          {security.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="account-security-empty">
              Nenhuma mudança de segurança registrada ainda.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="account-security-list">
              {security.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm"
                  data-testid={`account-security-${entry.id}`}
                  data-event={entry.event}
                >
                  <span className="font-medium">{identityAuditLabel(entry.event)}</span>
                  <span className="text-xs text-muted-foreground">
                    {IDENTITY_AUDIT_TONE_LABELS[identityAuditTone(entry.event)]}
                  </span>
                  {entry.ipAddress ? (
                    <span className="text-xs text-muted-foreground">IP {entry.ipAddress}</span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Enxergou algo que não reconhece? Troque a senha agora — a troca encerra as outras
            sessões — e desligue o segundo fator só depois de conferir os dispositivos acima.
          </p>
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
