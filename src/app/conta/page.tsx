import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Building2,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Smartphone,
  SunMoon,
  UserRound,
} from 'lucide-react';

import { getCurrentSession, loadMemberships } from '@/lib/auth/session';
import { summarizeMembershipAccess } from '@/domain/rbac/access-summary';
import { ENTRY_DISCOVERY_PATH } from '@/domain/platform/entry-destination-rules';
import { tenantDashboardPath } from '@/domain/platform/vitrine-account-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
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
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@/components/ui';

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

  const [account, sessions, params, security, memberships] = await Promise.all([
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
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CONTA PAGA UMA CONSULTA PELOS ACESSOS — E NÃO O CONTEXTO INTEIRO (FASE 84)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Até esta fase, papéis e permissões efetivas moravam no PAINEL da instituição.
     *  Eles são da PESSOA e da casa dela ao mesmo tempo: a pergunta "com o que eu
     *  entro aqui?" só tem resposta olhando TODOS os vínculos, e é a identidade —
     *  global — que os acumula. O painel deixa de mostrar isso (fatia 2) e a casa
     *  passa a ser esta seção.
     *
     *  O que se paga é UMA consulta (`loadMemberships`, administrativa e estritamente
     *  limitada ao `userId` da sessão): a lista de vínculos, com nome, slug, logo,
     *  situação, tipo e papéis. O que NÃO se paga é `getRequestContext()` — ele
     *  carregaria também o principal da instituição ativa sob RLS, e a conta é
     *  global: não há "instituição ativa" aqui. O comentário de `getCurrentSession`
     *  (FASE 47) já registrava essa escolha; ela continua valendo para a seção nova.
     *
     *  A tradução papel → rótulo e papel → permissões é PURA (`access-summary`), sem
     *  consulta nenhuma: o catálogo já está em memória.
     */
    loadMemberships(session.user.id),
  ]);

  if (!account) {
    redirect('/login');
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      {/**
        * ─────────────────────────────────────────────────────────────────────────────
        *  A CONTA É GLOBAL — E O TOPO DIZ ISSO (FASE 78 · fatia 3)
        * ─────────────────────────────────────────────────────────────────────────────
        *  Título e descrição são os mesmos de antes; o que mudou foi a FORMA: o `<h1>`
        *  escrito à mão usava `text-headline`, uma classe que não existe no
        *  `globals.css` nem no `DESIGN.md` — o título da conta renderizava em 16px, o
        *  menor de todas as telas. O `PageHeader` aplica o token de título de página
        *  (`text-title-lg`, 28px), o mesmo das 73 telas migradas.
        *
        *  A volta continua existindo, mas agora NOMEIA o destino ("as minhas
        *  instituições"): a tela é do grupo de autenticação e, por decisão da fatia,
        *  não ganha trilha inventada — o caminho de saída é uma ação do topo.
        */}
      <PageHeader
        title="Minha conta"
        icon={<UserRound className="size-6 text-primary" aria-hidden />}
        description="Seus dados de acesso valem em qualquer instituição — e existem mesmo para quem participa sem vínculo."
        actions={
          <Link
            href="/selecionar-instituicao"
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            Voltar para as minhas instituições
          </Link>
        }
      />

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

      {/* ── Seus acessos (FASE 84) ─────────────────────────────────────────── */}
      {/**
        * ───────────────────────────────────────────────────────────────────────────
        *  AQUI FICA O QUE O PAINEL MOSTRAVA — E O LUGAR É ESTE, NÃO O FIM DA PÁGINA
        * ───────────────────────────────────────────────────────────────────────────
        *  "Papéis acumulados neste contexto" e "Permissões efetivas" saíram do painel
        *  da instituição: eram a prova do motor de RBAC, não o que a pessoa precisa
        *  ver ao acordar. A prova não desapareceu — mudou de casa, para a identidade,
        *  que é onde os papéis realmente se acumulam (entre instituições).
        *
        *  A posição é ENTRE "Aparência" e "Foto e dados", e não depois de "Segurança e
        *  acessos", porque esta é a única seção que responde "onde eu entro, e com o
        *  quê?" — a pergunta de quem chega aqui a partir do botão de contexto do
        *  painel (fatia 3). Enterrada abaixo de foto, senha, segundo fator e
        *  dispositivos, ela só seria encontrada por quem já sabe que existe.
        *
        *  A ordem dos cartões não muda o `f60`/`axe` (medido: `/conta` NÃO está no
        *  portão de acessibilidade nem na varredura de landmark; a página não tem
        *  layout próprio). O que preserva a estrutura é o `CardTitle`, que continua
        *  sendo um `<h2>` abaixo do `<h1>` do `PageHeader`.
        *
        *  Nada de UUID e nada de chave crua: instituição pelo NOME, situação em
        *  português, papéis pelo `roleLabel` e um NÚMERO de permissões — o suficiente
        *  para responder "o que eu posso aqui?" sem virar a lista ilegível que o
        *  painel desenhava.
        */}
      <Card id="seus-acessos" data-testid="account-accesses">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" aria-hidden />
            Seus acessos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            As instituições em que esta conta entra, o papel que você tem em cada uma e
            quantas permissões efetivas isso soma. O painel de cada instituição mostra o
            que está acontecendo nela; os papéis e as permissões ficam aqui — e valem
            por instituição, nunca somados entre elas.
          </p>

          {memberships.length === 0 ? (
            <div className="space-y-2" data-testid="account-accesses-empty">
              <p className="text-sm text-muted-foreground">
                Sua conta ainda não está vinculada a nenhuma instituição. A inscrição em
                um evento público cria o primeiro vínculo.
              </p>
              <Link
                href={ENTRY_DISCOVERY_PATH}
                className="text-sm underline underline-offset-4 hover:text-foreground"
              >
                Explorar eventos
              </Link>
            </div>
          ) : (
            /**
             * `<ul>`/`<li>`, e não grade de `<div>` clicável: a lista é uma lista —
             * leitor de tela anuncia "lista, N itens" e cada linha tem um link com
             * nome próprio. O nome acessível do link COMEÇA pelo texto visível
             * ("Entrar", "Ver a instituição") e acrescenta a instituição, porque numa
             * lista de cinco linhas "Entrar" repetido não diz para onde leva.
             */
            <ul className="divide-y divide-border" data-testid="account-accesses-list">
              {memberships.map((membership) => {
                const access = summarizeMembershipAccess(membership.roles);
                const active = membership.status === 'ACTIVE';
                const href = active
                  ? tenantDashboardPath(membership.tenantSlug)
                  : tenantPath(membership.tenantSlug);
                const actionLabel = active ? 'Entrar' : 'Ver a instituição';

                return (
                  <li
                    key={membership.tenantId}
                    className="flex flex-wrap items-start justify-between gap-3 py-3"
                    data-testid={`account-access-${membership.tenantSlug}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{membership.tenantName}</p>

                      {active ? (
                        <p className="text-sm text-muted-foreground">
                          {access.roles.length === 0
                            ? 'Sem papel atribuído'
                            : access.roles.map((role) => role.label).join(' · ')}
                          {' · '}
                          {access.permissionCount}{' '}
                          {access.permissionCount === 1
                            ? 'permissão efetiva'
                            : 'permissões efetivas'}
                        </p>
                      ) : (
                        /**
                         * O convite NÃO cria papel: `MEMBER` + papel nascem no aceite
                         * (FASE 15). Mostrar "Sem papel · 0 permissões" seria verdade
                         * e ruído — a frase certa é a consequência, não o zero. E o
                         * aceite exige o código que só existe no e-mail; a tela não
                         * inventa um botão que não teria efeito.
                         */
                        <p className="text-sm text-muted-foreground">
                          O papel e as permissões passam a valer quando você aceitar o
                          convite — o link do aceite está no e-mail que você recebeu.
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={active ? 'success' : 'warning'} withDot>
                        {active ? 'Ativo' : 'Convite pendente'}
                      </Badge>
                      <Link
                        href={href}
                        className={buttonClasses({ variant: 'outline', size: 'sm' })}
                        aria-label={
                          active
                            ? `Entrar em ${membership.tenantName}`
                            : `Ver a instituição ${membership.tenantName}`
                        }
                      >
                        {actionLabel}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
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
