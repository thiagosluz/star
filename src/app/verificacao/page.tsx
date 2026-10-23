import Link from 'next/link';
import { BadgeCheck, ShieldAlert } from 'lucide-react';

import { getAuthenticatedUser } from '@/lib/auth/session';
import { buttonClasses, PageHeader } from '@/components/ui';
import { PLATFORM_NAV_GROUP } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Confirmação de e-mail' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RESULTADO DA CONFIRMAÇÃO DE E-MAIL — `/verificacao` (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O Better Auth confirma o endereço em `/api/auth/verify-email` e redireciona para
 *  o `callbackURL`. Sem uma página de destino, a pessoa clicava no link do e-mail e
 *  caía na raiz — sem saber se o endereço foi confirmado ou se algo deu errado.
 *
 *  O parâmetro `error` vem da própria biblioteca (`invalid_token`,
 *  `token_expired`): quando ele existe, o token não valia, e a página diz o que
 *  fazer — pedir outro e-mail, que é o caminho de dentro da conta.
 *
 *  A página NÃO exige sessão: o link pode ser aberto em outro navegador, e o aceite
 *  do convite de equipe depende justamente de a pessoa confirmar o endereço que a
 *  instituição cadastrou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const user = await getAuthenticatedUser();
  const failed = Boolean(error);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader
        eyebrow={PLATFORM_NAV_GROUP}
        title={failed ? 'O link não valeu' : 'E-mail confirmado!'}
        titleTestId="verification-title"
        icon={
          failed ? (
            <ShieldAlert className="size-7 text-warning" aria-hidden />
          ) : (
            <BadgeCheck className="size-7 text-success-strong" aria-hidden />
          )
        }
        description={
          failed
            ? 'O link de confirmação expirou ou já foi usado. Entre na sua conta e peça outro — o novo chega em instantes.'
            : 'Seu endereço está confirmado. É o que permite recuperar a senha e receber os avisos dos eventos.'
        }
        data-testid="verification-result"
      />

      <p className="text-xs text-muted-foreground">
        {user
          ? `Você está na conta ${user.email}.`
          : 'Você pode fechar esta aba e voltar ao seu e-mail.'}
      </p>

      <div className="flex flex-wrap gap-3">
        {user ? (
          <Link href="/selecionar-instituicao" className={buttonClasses({ variant: 'primary' })}>
            Ir para as minhas instituições
          </Link>
        ) : (
          <>
            <Link href="/login" className={buttonClasses({ variant: 'primary' })}>
              Entrar
            </Link>
            <Link href="/signup" className={buttonClasses({ variant: 'outline' })}>
              Criar conta
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
